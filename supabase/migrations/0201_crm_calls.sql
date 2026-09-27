-- 0201: CRM calling -- one tap to log how a call went, "unreachable" after
-- repeated misses, and a ranked list of who to call next.
--
-- Borrowed from the IPC control center, which the owner's sales team lives
-- in: the dial never waits on a form, and logging the outcome is one more
-- tap. What the outcome means is decided here, once, so every screen agrees:
--
--   answered / callback ............ they picked up: attempts reset, contacted
--   no_answer / busy / switched_off
--   / voicemail .................... one more miss; three in a row = unreachable
--   wrong_number ................... unreachable straight away
--
-- The queue ranks the caller's open leads by what is most owed: a promised
-- call-back that is due, a follow-up that has slipped, one due today, a new
-- enquiry nobody has rung, a quotation gone quiet, a hot lead with nothing
-- planned. Each row says why it is there, in words.

alter table crm_leads
  add column if not exists call_attempts    int not null default 0,
  add column if not exists last_call_at     timestamptz,
  add column if not exists last_call_outcome text;

-- What a call outcome does to the lead. Runs after the existing activity
-- trigger (which stamps last_contacted_at), so the verdict here is the last word.
create or replace function crm_call_outcome_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missed boolean;
begin
  if new.lead_id is null or new.type <> 'call' or new.outcome is null then return null; end if;
  -- An outcome is counted once: when the call is logged with it, or when an
  -- outcome is first added to a call logged without one.
  if tg_op = 'UPDATE' and old.outcome is not null then return null; end if;

  v_missed := new.outcome in ('no_answer', 'busy', 'switched_off', 'voicemail');
  update crm_leads l
     set last_call_at      = coalesce(new.started_at, new.created_at),
         last_call_outcome = new.outcome,
         call_attempts     = case when v_missed then l.call_attempts + 1
                                  when new.outcome = 'wrong_number' then l.call_attempts
                                  else 0 end,
         contacted_status  = case
                               when new.outcome in ('answered', 'callback') then 'contacted'
                               when new.outcome = 'wrong_number' then 'unreachable'
                               when v_missed and l.call_attempts + 1 >= 3 then 'unreachable'
                               else l.contacted_status
                             end
   where l.id = new.lead_id;
  return null;
end;
$$;
drop trigger if exists crm_activities_zz_call_outcome on crm_activities;
create trigger crm_activities_zz_call_outcome
  after insert or update of outcome on crm_activities
  for each row execute function crm_call_outcome_apply();

/**
 * Who to call next. 'mine' = leads assigned to me; 'all' = the studio's
 * (the API offers it to owners and admins). Runs as the caller, so RLS keeps
 * it to their own studio. Won, lost, archived and merged leads never appear.
 */
create or replace function crm_call_queue(p_scope text default 'mine', p_now timestamptz default now())
returns table (
  id                uuid,
  name              text,
  phone             text,
  event_type        text,
  event_date        date,
  city              text,
  status            text,
  quality           text,
  follow_up_at      timestamptz,
  last_contacted_at timestamptz,
  last_call_outcome text,
  call_attempts     int,
  assigned_to       uuid,
  priority          int,
  reason            text
)
language sql
stable
set search_path = public
as $$
  with t as (
    select (p_now at time zone 'Asia/Kolkata')::date as today
  ), open_leads as (
    select l.*
      from crm_leads l
     where not l.is_archived
       and l.merged_into is null
       and l.status not in ('converted', 'lost')
       and (p_scope = 'all' or l.assigned_to = auth.uid())
  ), scored as (
    select l.*,
           ((l.follow_up_at at time zone 'Asia/Kolkata')::date) as fu_day,
           t.today
      from open_leads l, t
  ), ranked as (
    select s.*,
      case
        when s.last_call_outcome = 'callback' and s.follow_up_at is not null and s.follow_up_at <= p_now then 120
        when s.fu_day is not null and s.fu_day < s.today then 100 + least(s.today - s.fu_day, 9)
        when s.fu_day = s.today then 80
        when s.last_contacted_at is null and s.contacted_status <> 'unreachable' then
          case when s.created_at > p_now - interval '2 days' then 75 else 65 end
        when s.status = 'proposal_sent' and coalesce(s.last_contacted_at, s.created_at) < p_now - interval '3 days' then 60
        when s.contacted_status <> 'unreachable' and s.call_attempts > 0 and s.follow_up_at is null then 55
        when s.is_hot and s.follow_up_at is null then 50
        else null
      end as priority
      from scored s
  )
  select r.id, r.name, r.phone, r.event_type, r.event_date, r.city, r.status, r.quality,
         r.follow_up_at, r.last_contacted_at, r.last_call_outcome, r.call_attempts, r.assigned_to,
         r.priority,
         case
           when r.priority >= 120 then 'Asked to be called back'
           when r.priority > 100 then 'Follow-up ' || (r.today - r.fu_day) || ' day' || case when r.today - r.fu_day = 1 then '' else 's' end || ' late'
           when r.priority = 80 then 'Follow-up due today'
           when r.priority = 75 then 'New enquiry, not called yet'
           when r.priority = 65 then 'Never called'
           when r.priority = 60 then 'Quotation sent, quiet for ' || greatest(3, (p_now::date - coalesce(r.last_contacted_at, r.created_at)::date)) || ' days'
           when r.priority = 55 then 'Tried ' || r.call_attempts || ' time' || case when r.call_attempts = 1 then '' else 's' end || ', no answer'
           else 'Hot, nothing planned'
         end as reason
    from ranked r
   where r.priority is not null
   order by r.priority desc, r.follow_up_at nulls last, r.created_at desc
   limit 200
$$;
revoke all on function crm_call_queue(text, timestamptz) from public, anon;
grant execute on function crm_call_queue(text, timestamptz) to authenticated;
