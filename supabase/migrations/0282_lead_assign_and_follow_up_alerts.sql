-- 0282: a lead given to someone tells them, and a follow-up rings its owner's
-- bell before it is due (owner, 25 Oct: "the notification should be only for
-- that person or whoever has set the follow-up; if we are assigning the lead
-- to any team member, then the notification will go to them only").
--
-- 1. crm_leads_assigned_notify: when a lead is given to someone (or moved to
--    someone else), their bell says "New lead for you: Priya Sharma" with the
--    event, date, city and who gave it, and opens the lead. Giving a lead to
--    yourself says nothing. A lead that arrives by itself (form, Facebook,
--    the rota) is already announced by the studio's "new lead" workflow, so
--    only a lead someone hands over (auth.uid() set) is announced here.
--    Moving a lead also moves the old person's open follow-ups on it to the
--    new person, so the promise goes with the family.
--
-- 2. crm_follow_up_soon(): run on the five-minute messages tick. Every open
--    follow-up due in the next 15 minutes (or in the last 5, if a tick was
--    missed) rings once, for one person: the one it was given to, else the
--    lead's owner, else whoever wrote it -- the same "whose is it" rule as
--    /me/follow-ups and the on-screen reminder. A follow-up moved to a new
--    time rings again for the new time. Nobody else is told.
--
-- Safe to run twice: create or replace, drop trigger if exists.

create or replace function crm_leads_assigned_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by   uuid := auth.uid();
  v_name text;
  v_body text;
begin
  if new.assigned_to is null or new.assigned_to is not distinct from v_by then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;
  -- A lead that arrived by itself is announced by the new-lead workflow.
  if tg_op = 'INSERT' and v_by is null then
    return new;
  end if;
  -- Only a working member of this studio is told.
  if not exists (
    select 1 from users u
     where u.user_id = new.assigned_to and u.company_id = new.company_id
       and u.deleted_at is null and u.status = 'active'
  ) then
    return new;
  end if;

  select u.name into v_name from users u where u.user_id = v_by;
  v_body := concat_ws(' · ',
    nullif(new.event_type, ''),
    to_char(new.event_date, 'FMDD Mon YYYY'),
    nullif(new.city, ''),
    case when v_name is not null then 'from ' || v_name end);

  perform create_notification(
    new.company_id, new.assigned_to, 'crm_assigned',
    'New lead for you: ' || coalesce(nullif(new.name, ''), 'a new lead'),
    nullif(v_body, ''),
    'crm_assigned:' || new.id || ':' || new.assigned_to || ':' || extract(epoch from now())::bigint,
    'crm_lead', new.id, 'info',
    '/follow-ups?lead=' || new.id,
    jsonb_build_object('lead_id', new.id, 'by', v_by));

  -- The old person's open follow-ups on this lead go with it.
  if tg_op = 'UPDATE' and old.assigned_to is not null then
    update crm_activities
       set assigned_to = new.assigned_to
     where lead_id = new.id and type = 'task' and done_at is null
       and assigned_to = old.assigned_to;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_assigned_notify on crm_leads;
create trigger crm_leads_assigned_notify
  after insert or update of assigned_to on crm_leads
  for each row execute function crm_leads_assigned_notify();

create or replace function crm_follow_up_soon()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select a.id, a.company_id, a.lead_id, a.due_at, a.subject, a.body,
           l.name as lead_name, l.phone as lead_phone,
           coalesce(a.assigned_to, l.assigned_to, a.actor_id) as whose
      from crm_activities a
      join crm_leads l on l.id = a.lead_id
     where a.type = 'task' and a.done_at is null and a.due_at is not null
       and a.due_at between now() - interval '5 minutes' and now() + interval '15 minutes'
       and coalesce(l.is_archived, false) = false
  loop
    continue when r.whose is null;
    continue when not exists (
      select 1 from users u
       where u.user_id = r.whose and u.company_id = r.company_id
         and u.deleted_at is null and u.status = 'active');
    if create_notification(
      r.company_id, r.whose, 'crm_follow_up_soon',
      coalesce(nullif(r.subject, ''), 'Follow-up') || ' at '
        || to_char(r.due_at at time zone 'Asia/Kolkata', 'FMHH12:MI am') || ': '
        || coalesce(nullif(r.lead_name, ''), 'a lead'),
      nullif(concat_ws(' · ', nullif(r.lead_phone, ''), nullif(left(r.body, 140), '')), ''),
      'crm_soon:' || r.id || ':' || extract(epoch from r.due_at)::bigint,
      'crm_lead', r.lead_id, 'warning',
      '/follow-ups?lead=' || r.lead_id,
      jsonb_build_object('activity_id', r.id, 'due_at', r.due_at))
    then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

revoke all on function crm_follow_up_soon() from public, anon, authenticated;
grant execute on function crm_follow_up_soon() to service_role;
