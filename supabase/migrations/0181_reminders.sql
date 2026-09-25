-- 0181: "Remind me" -- a reminder can be about a deliverable, and a due
-- reminder says where to go. Additive and idempotent.
--
-- 1. A reminder could be linked to a lead, project, client, invoice,
--    enquiry, task or shoot (0081, 0105) but not to a deliverable -- the
--    thing an editor most often needs nudging about. The check constraint
--    is what refused it, so widening the contract alone would have passed
--    validation and then failed the insert.
-- 2. list_reminders names a linked deliverable, as it does every other kind.
--    Each name lookup is now also held to the reminder's own studio: the API
--    stores whatever id it is sent and this function runs as definer, so an
--    id from another studio would have read back that studio's name.
-- 3. run_reminder_cron raised the alert with no body and no link, so a due
--    reminder in the bell said what but not where, and the note written with
--    it was never shown. It now carries the note, a link back to the thing
--    it is about, and a severity taken from the reminder's priority.

-- ── 1. deliverable as a reminder kind ───────────────────────────
alter table reminders drop constraint if exists reminders_entity_type_check;
alter table reminders add constraint reminders_entity_type_check
  check (entity_type is null or entity_type in ('lead', 'project', 'client', 'invoice', 'custom',
                                                'enquiry', 'task', 'shoot', 'general', 'deliverable'));

-- ── 2. list_reminders: same signature as 0107, so still one overload ──
create or replace function list_reminders(
  p_status      text default null,
  p_priority    text default null,
  p_user_id     uuid default null,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_due_from    timestamptz default null,
  p_due_to      timestamptz default null,
  p_overdue     boolean default null,
  p_search      text default null,
  p_limit       int default 50,
  p_cursor      timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_items   jsonb;
  v_summary jsonb;
  v_needle  text;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_needle := case when nullif(trim(coalesce(p_search, '')), '') is null
                   then null else '%' || trim(p_search) || '%' end;

  select jsonb_agg(row_to_json(r)) into v_items
  from (
    select rm.id, rm.company_id, rm.user_id, rm.created_by, rm.title, rm.description, rm.priority, rm.status,
           rm.entity_type, rm.entity_id, rm.due_at, rm.created_at,
           case rm.entity_type
             when 'lead' then (select l.name from crm_leads l where l.id = rm.entity_id and l.company_id = rm.company_id)
             when 'project' then (select p.name from projects p where p.id = rm.entity_id and p.company_id = rm.company_id)
             when 'client' then (select c.name from clients c where c.id = rm.entity_id and c.company_id = rm.company_id)
             when 'invoice' then (select i.invoice_number from invoices i where i.id = rm.entity_id and i.company_id = rm.company_id)
             when 'enquiry' then (select e.name from enquiries e where e.id = rm.entity_id and e.company_id = rm.company_id)
             when 'task' then (select t.title from tasks t where t.id = rm.entity_id and t.company_id = rm.company_id)
             when 'shoot' then (select s.name from shoots s where s.id = rm.entity_id and s.company_id = rm.company_id)
             when 'deliverable' then (select d.title from deliverables d where d.id = rm.entity_id and d.company_id = rm.company_id)
             else null
           end as entity_name
      from reminders rm
     where rm.company_id = v_company
       and (p_status is null or rm.status = p_status)
       and (p_priority is null or rm.priority = p_priority)
       and (p_user_id is null or rm.user_id = p_user_id)
       and (p_entity_type is null or rm.entity_type = p_entity_type)
       and (p_entity_id is null or rm.entity_id = p_entity_id)
       and (p_due_from is null or rm.due_at >= p_due_from)
       and (p_due_to is null or rm.due_at <= p_due_to)
       and (p_overdue is null or not p_overdue or (rm.status = 'active' and rm.due_at < now()))
       and (v_needle is null or rm.title ilike v_needle or coalesce(rm.description, '') ilike v_needle)
       and (p_cursor is null or rm.created_at < p_cursor)
     order by
       case rm.priority when 'urgent' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
       rm.due_at nulls last,
       rm.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 50))
  ) r;

  select jsonb_build_object(
    'total_count', count(*)::int,
    'active_count', count(*) filter (where status = 'active')::int,
    'overdue_count', count(*) filter (where status = 'active' and due_at < now())::int,
    'due_today_count', count(*) filter (where status = 'active' and due_at::date = current_date)::int
  ) into v_summary
  from reminders
  where company_id = v_company and (p_user_id is null or user_id = p_user_id);

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'summary', v_summary
  );
end;
$$;
revoke all on function list_reminders(text, text, uuid, text, uuid, timestamptz, timestamptz, boolean, text, int, timestamptz) from public, anon;
grant execute on function list_reminders(text, text, uuid, text, uuid, timestamptz, timestamptz, boolean, text, int, timestamptz) to authenticated;

-- ── 3. where a due reminder takes you ───────────────────────────
-- Back to the thing it is about. A task goes to the list it is worked from:
-- someone on the task works it from My tasks; anyone else (a manager who set
-- it from the project) goes back to that project's Tasks tab. Held to the
-- reminder's studio, so a stray id can never become a link into another
-- studio's records; when the thing is gone, or was never ours, the reminders
-- board is the honest place to land.
--
-- Not a definer function: it is only ever called from run_reminder_cron,
-- which already runs as the owner.
create or replace function reminder_deep_link(
  p_company     uuid,
  p_user        uuid,
  p_entity_type text,
  p_entity_id   uuid
)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    case p_entity_type
      when 'project' then (
        select '/projects/' || p.id from projects p where p.id = p_entity_id and p.company_id = p_company)
      when 'shoot' then (
        select '/shoots/' || s.id from shoots s where s.id = p_entity_id and s.company_id = p_company)
      when 'deliverable' then (
        select '/projects/' || d.project_id || '?tab=deliverables&d=' || d.id
          from deliverables d where d.id = p_entity_id and d.company_id = p_company)
      when 'task' then (
        select case
                 when exists (select 1 from task_assignees ta where ta.task_id = t.id and ta.user_id = p_user)
                   then '/tasks/my'
                 when t.project_id is not null then '/projects/' || t.project_id || '?tab=tasks'
                 else '/tasks'
               end
          from tasks t where t.id = p_entity_id and t.company_id = p_company)
      when 'lead' then (
        select '/follow-ups?lead=' || l.id from crm_leads l where l.id = p_entity_id and l.company_id = p_company)
      when 'invoice' then (
        select '/billing/invoices/' || i.id from invoices i where i.id = p_entity_id and i.company_id = p_company)
      else null
    end,
    '/reminders');
$$;
revoke all on function reminder_deep_link(uuid, uuid, text, uuid) from public, anon;

-- Same sweep and the same one-alert-per-reminder dedupe key as 0060; only
-- what the alert carries has changed.
create or replace function run_reminder_cron(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due     int := 0;
  v_created int := 0;
  v_r       record;
  v_summary jsonb;
  v_run     uuid;
begin
  insert into cron_runs (job_name, dry_run) values ('reminder_cron', p_dry_run) returning id into v_run;

  for v_r in
    select * from reminders where status = 'active' and due_at is not null and due_at <= now()
  loop
    v_due := v_due + 1;
    if not p_dry_run then
      if create_notification(
           v_r.company_id, v_r.user_id, 'reminder', v_r.title,
           nullif(btrim(coalesce(v_r.description, '')), ''),
           'reminder:' || v_r.id, v_r.entity_type, v_r.entity_id,
           case v_r.priority when 'urgent' then 'critical' when 'high' then 'warning' else 'info' end,
           reminder_deep_link(v_r.company_id, v_r.user_id, v_r.entity_type, v_r.entity_id)) then
        v_created := v_created + 1;
      end if;
    end if;
  end loop;

  v_summary := jsonb_build_object('reminders_due', v_due, 'notifications_created', v_created, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;
revoke all on function run_reminder_cron(boolean) from public, anon;
grant execute on function run_reminder_cron(boolean) to service_role;
