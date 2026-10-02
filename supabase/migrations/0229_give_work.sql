-- 0229: giving work to an editor and hearing back.
--
--   * deliverables.assigned_by: who gave the work to its editor, set whenever
--     the editor changes.
--   * deliverable_handed_in(): when an editor hands in work on a deliverable,
--     whoever gave it to them (else the studio's owners and admins) is told.
--   * notifications_deliverable_link(): a deliverable alert that opens
--     "/my-work" opens the item itself ("/my-work?d=<id>").
--   * alert_email_due() also emails deliverable assigned / due / changes
--     requested / handed in.

-- Who gave the work to its editor. Set by trigger whenever the editor
-- changes, from the person making the change; cleared with the editor.
alter table deliverables
  add column if not exists assigned_by uuid references users (user_id) on delete set null;

create or replace function deliverables_set_assigned_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.assignee_id is null then
    new.assigned_by := null;
  elsif tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    new.assigned_by := coalesce(auth.uid(), new.assigned_by);
  end if;
  return new;
end;
$$;

drop trigger if exists deliverables_assigned_by on deliverables;
create trigger deliverables_assigned_by
  before insert or update of assignee_id on deliverables
  for each row execute function deliverables_set_assigned_by();

-- An editor handed in work on a deliverable: tell whoever gave it to them,
-- or, when nobody is recorded, the studio's owner and admins. Never the
-- person who handed it in.
create or replace function deliverable_handed_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d      record;
  v_who    text;
  v_to     uuid;
  v_by     uuid := coalesce(new.submitted_by, auth.uid());
begin
  if new.deliverable_id is null then
    return new;
  end if;
  select d.id, d.title, d.project_id, d.assigned_by, d.company_id
    into v_d from deliverables d where d.id = new.deliverable_id;
  if not found then
    return new;
  end if;
  select coalesce(nullif(btrim(u.name), ''), 'Your editor') into v_who
    from users u where u.user_id = v_by and u.company_id = v_d.company_id;
  v_who := coalesce(v_who, 'Your editor');

  for v_to in
    select x from (
      select v_d.assigned_by as x where v_d.assigned_by is not null
      union
      select c.owner_user_id from companies c
       where v_d.assigned_by is null and c.id = v_d.company_id and c.owner_user_id is not null
      union
      select u.user_id from users u
       where v_d.assigned_by is null and u.company_id = v_d.company_id
         and u.role in ('super_admin', 'admin') and u.status = 'active' and u.deleted_at is null
    ) r
    where x is distinct from v_by
  loop
    perform create_notification(
      v_d.company_id, v_to, 'deliverable_submitted',
      v_who || ' handed in ' || v_d.title,
      coalesce((select p.name from projects p where p.id = v_d.project_id), '')
        || case when nullif(btrim(coalesce(new.submission_link, '')), '') is not null then ' · link added' else '' end,
      'deliverable_submitted:' || new.id || ':' || v_to,
      'deliverable', v_d.id, 'info',
      '/projects/' || v_d.project_id || '?tab=completed_work');
  end loop;
  return new;
end;
$$;

drop trigger if exists team_work_submissions_handed_in on team_work_submissions;
create trigger team_work_submissions_handed_in
  after insert on team_work_submissions
  for each row execute function deliverable_handed_in();

-- A deliverable alert that would open "My work" opens the item itself.
create or replace function notifications_deliverable_link()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type like 'deliverable%'
     and new.entity_type = 'deliverable' and new.entity_id is not null
     and coalesce(new.deep_link, '') = '/my-work' then
    new.deep_link := '/my-work?d=' || new.entity_id;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_deliverable_link on notifications;
create trigger notifications_deliverable_link
  before insert on notifications
  for each row execute function notifications_deliverable_link();

update notifications
   set deep_link = '/my-work?d=' || entity_id
 where type like 'deliverable%' and entity_type = 'deliverable' and entity_id is not null
   and deep_link = '/my-work' and read_at is null;

-- Copied from 0227; the deliverable alerts join the list.
create or replace function alert_email_due(p_limit int default 500)
returns table (
  notification_id uuid,
  company_id      uuid,
  studio_name     text,
  recipient_uid   uuid,
  email           text,
  name            text,
  type            text,
  title           text,
  body            text,
  deep_link       text,
  created_at      timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.company_id, c.name, n.recipient_uid, u.email, u.name,
         n.type, n.title, n.body, n.deep_link, n.created_at
    from notifications n
    join users u on u.user_id = n.recipient_uid and u.company_id = n.company_id
    join companies c on c.id = n.company_id
   where n.type in (
           'shoot_assigned', 'shoot_tomorrow',
           'task.assigned', 'task.status', 'task.overdue', 'task_start',
           'deliverable_start', 'deliverable_assigned', 'deliverable_due',
           'deliverable_changes_requested', 'deliverable_submitted',
           'data.pending', 'data.backup_pending', 'data.handover',
           'allocation.conflict'
         )
     and n.read_at is null
     and n.dismissed_at is null
     and n.created_at <= now() - interval '15 minutes'
     and n.created_at >  now() - interval '1 day'
     and u.status = 'active'
     and u.deleted_at is null
     and u.alert_emails
     and u.email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'
     and u.email !~* '@(([^@]*\.)?example\.(com|org|net)|[^@]*\.(test|example|invalid|localhost|local))$'
     and not exists (
       select 1 from notification_deliveries d where d.notification_id = n.id and d.channel = 'email'
     )
   order by n.recipient_uid, n.created_at
   limit greatest(coalesce(p_limit, 500), 1);
$$;
revoke all on function alert_email_due(int) from public, anon, authenticated;
grant execute on function alert_email_due(int) to service_role;
