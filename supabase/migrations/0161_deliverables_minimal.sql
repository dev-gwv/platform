-- Deliverables: who is editing it, where it stands, and where it was sent.
--
-- A deliverable could say it was pending, in progress, completed or
-- cancelled, and nothing else. There was no "who is editing this" (that meant
-- making a task and assigning the task on another page), no "the client has
-- it and is reviewing", and nowhere to put the link that was sent. This adds
-- those three things and nothing more:
--
--   status       gains 'review' -- "With client". The old values keep their
--                meaning, so project tracking (status = 'completed'), tasks
--                and quotations read them as before.
--   assignee_id  the editor or designer on it.
--   delivery_link / delivered_at  what was sent, and when it was delivered.
--
-- It also closes three holes found on the way:
--
--   * A deliverable's project, shoot and editor are now checked against the
--     row's studio. Before, a POST with another studio's project id went in
--     (foreign keys ignore RLS) and the SECURITY DEFINER totals trigger then
--     rewrote that other project's total_cost. create_task_with_assignees had
--     the same gap for its project and deliverable.
--   * An internal item can no longer be "shown on quotation". The public
--     quotation reader filters on show_on_quotation only, so internal team
--     work (culling, backups) was listed to the client.
--   * create_project_from_template named columns that do not exist
--     (deliverables.name, projects.start_date, shoots.kind, tasks.sort_order)
--     and a task status of 'todo', so every use of it failed.

-- ── columns ──────────────────────────────────────────────────────
alter table deliverables drop constraint if exists deliverables_status_check;
alter table deliverables
  add constraint deliverables_status_check
  check (status in ('pending', 'in_progress', 'review', 'completed', 'cancelled'));

alter table deliverables
  add column if not exists assignee_id   uuid references users (user_id) on delete set null,
  add column if not exists delivery_link text,
  add column if not exists delivered_at  timestamptz;

create index if not exists deliverables_assignee_idx on deliverables (assignee_id) where assignee_id is not null;
create index if not exists deliverables_shoot_idx on deliverables (shoot_id) where shoot_id is not null;

-- ── the rules every write goes through ───────────────────────────
create or replace function deliverables_normalise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from projects p where p.id = new.project_id and p.company_id = new.company_id) then
    raise exception 'That project is not in this studio.' using errcode = '42501';
  end if;
  if new.shoot_id is not null and not exists (
       select 1 from shoots s
        where s.id = new.shoot_id and s.company_id = new.company_id and s.project_id = new.project_id) then
    raise exception 'That shoot is not part of this project.' using errcode = '23514';
  end if;
  if new.assignee_id is not null and not exists (
       select 1 from users u where u.user_id = new.assignee_id and u.company_id = new.company_id) then
    raise exception 'That person is not on this studio''s team.' using errcode = '23514';
  end if;

  -- Team work is never promised on a quotation.
  if new.visibility_scope = 'internal' then
    new.show_on_quotation := false;
  end if;

  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' or new.delivered_at is null then
      new.delivered_at := coalesce(new.delivered_at, now());
    end if;
  else
    new.delivered_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists deliverables_normalise on deliverables;
create trigger deliverables_normalise
  before insert or update on deliverables
  for each row execute function deliverables_normalise();

-- ── backfill ─────────────────────────────────────────────────────
-- One shoot per deliverable is the model now; take the earliest linked one.
update deliverables d
   set shoot_id = (
     select l.shoot_id from deliverable_shoot_links l
       join shoots s on s.id = l.shoot_id
      where l.deliverable_id = d.id
      order by s.shoot_date nulls last, s.created_at
      limit 1)
 where d.shoot_id is null
   and exists (select 1 from deliverable_shoot_links l where l.deliverable_id = d.id);

update deliverables set show_on_quotation = false
 where visibility_scope = 'internal' and show_on_quotation;

update deliverables set delivered_at = updated_at
 where status = 'completed' and delivered_at is null;

-- ── create_task_with_assignees: same body, own-studio check added ──
create or replace function create_task_with_assignees(
  p_project_id     uuid,
  p_deliverable_id uuid,
  p_title          text,
  p_status         task_status default 'to_do',
  p_priority       task_priority default 'medium',
  p_due_date       date default null,
  p_assignees      uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_task    uuid;
begin
  if not is_current_admin_or_manager() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_project_id is not null
     and not exists (select 1 from projects where id = p_project_id and company_id = v_company) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_deliverable_id is not null
     and not exists (select 1 from deliverables where id = p_deliverable_id and company_id = v_company) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into tasks (company_id, project_id, deliverable_id, title, status, priority, due_date, created_by)
    values (v_company, p_project_id, p_deliverable_id, p_title, p_status, p_priority, p_due_date, auth.uid())
    returning id into v_task;

  insert into task_assignees (task_id, user_id, company_id)
    select v_task, u, v_company from unnest(coalesce(p_assignees, '{}')) as u
    where exists (select 1 from users where user_id = u and company_id = v_company);

  return v_task;
end;
$$;

-- ── create_project_from_template, against the real tables ─────────
create or replace function create_project_from_template(
  p_template_id uuid,
  p_name        text,
  p_client_id   uuid default null,
  p_start_date  date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := get_current_company_id();
  v_template project_templates;
  v_project  uuid;
  v_item     jsonb;
  v_qty      int;
  v_priority task_priority;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_template from project_templates
   where id = p_template_id and company_id = v_company;
  if v_template.id is null then
    raise exception 'template not found' using errcode = 'P0001';
  end if;

  if p_client_id is null
     or not exists (select 1 from clients where id = p_client_id and company_id = v_company) then
    raise exception 'Pick a client for this project.' using errcode = '23514';
  end if;

  insert into projects (company_id, name, client_id, status, created_by)
  values (v_company, p_name, p_client_id, 'active', auth.uid())
  returning id into v_project;

  -- "Album ×2" rather than a quantity column nothing else reads.
  for v_item in select * from jsonb_array_elements(v_template.deliverables_json)
  loop
    v_qty := coalesce((v_item->>'quantity')::int, 1);
    insert into deliverables (company_id, project_id, title, description)
    values (
      v_company, v_project,
      (v_item->>'name') || case when v_qty > 1 then ' ×' || v_qty else '' end,
      nullif(v_item->>'description', '')
    );
  end loop;

  -- The template's shoots all start on the chosen date; they are moved from
  -- the project once the real dates are known.
  for v_item in select * from jsonb_array_elements(v_template.shoots_json)
  loop
    insert into shoots (company_id, project_id, name, shoot_date, status)
    values (v_company, v_project, v_item->>'name', p_start_date, 'planned');
  end loop;

  for v_item in select * from jsonb_array_elements(v_template.tasks_json)
  loop
    v_priority := case when v_item->>'priority' in ('low', 'medium', 'high', 'urgent')
                       then (v_item->>'priority')::task_priority else 'medium' end;
    insert into tasks (company_id, project_id, title, priority, status, created_by)
    values (v_company, v_project, v_item->>'title', v_priority, 'to_do', auth.uid());
  end loop;

  return v_project;
end;
$$;
