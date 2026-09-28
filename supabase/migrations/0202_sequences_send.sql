-- 0202: sequences that send, per-studio feature switches, and the studio's
-- own name on the emails it sends.
--
-- A cadence (0036) only ever reminded someone: "step 2 due". Privyr's
-- sequences, which the owner likes, write the message too. So a step now has
-- a channel:
--
--   reminder .... as before: the lead's owner is told it is due
--   whatsapp .... the message is written and waits in "Send now" for one tap
--                 on the studio's own WhatsApp (sent by the API once the
--                 studio connects its number -- 0203)
--   email ....... sent by us, as the studio, when the studio has automatic
--                 sequences; otherwise it waits in "Send now" like WhatsApp
--
-- Every message a sequence produces is a row in crm_sequence_sends, claimed
-- before it is sent, so nothing goes twice and "what did we send this lead"
-- always has an answer. A reply (any inbound message or call) takes the lead
-- off a sequence that says so; winning or losing it always does.
--
-- A sequence may start by itself: for every new lead (optionally only from
-- one source), or when a lead reaches a stage. Imported leads never start one
-- on their own -- an import of last year's list must not message all of it.
--
-- company_entitlements are the higher-tier switches the platform turns on per
-- studio: sequences_auto (emails go out by themselves), whatsapp_api (0203),
-- white_label (no IPC Studios on anything a client receives).

-- ── Steps and sequences ──────────────────────────────────────
alter table crm_cadence_steps
  add column if not exists channel   text not null default 'reminder' check (channel in ('reminder', 'whatsapp', 'email')),
  add column if not exists send_hour int  not null default 10 check (send_hour between 6 and 21),
  add column if not exists subject   text check (subject is null or char_length(subject) <= 150),
  add column if not exists body      text check (body is null or char_length(body) <= 4000);

alter table crm_cadences
  add column if not exists auto_start    boolean not null default false,
  add column if not exists stop_on_reply boolean not null default true,
  add column if not exists starter_key   text;
create unique index if not exists crm_cadences_starter_uq on crm_cadences (company_id, starter_key) where starter_key is not null;

alter table crm_lead_cadences
  add column if not exists stopped_reason text;

-- 0036 put a step at 10:00 UTC, which is 3:30 pm here. A step lands at its
-- hour in India, counted in Indian days from the day the lead started.
create or replace function crm_cadence_step_time(p_started timestamptz, p_day_offset int)
returns timestamptz
language sql
immutable
as $$
  select (((p_started at time zone 'Asia/Kolkata')::date + p_day_offset) + time '10:00') at time zone 'Asia/Kolkata'
$$;

create or replace function crm_sequence_step_at(p_started timestamptz, p_day_offset int, p_hour int)
returns timestamptz
language sql
immutable
as $$
  select (((p_started at time zone 'Asia/Kolkata')::date + p_day_offset) + make_time(coalesce(p_hour, 10), 0, 0)) at time zone 'Asia/Kolkata'
$$;

-- ── Feature switches ─────────────────────────────────────────
create table if not exists company_entitlements (
  company_id uuid not null references companies (id) on delete cascade,
  key        text not null check (key in ('sequences_auto', 'whatsapp_api', 'white_label')),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (company_id, key)
);
alter table company_entitlements enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'company_entitlements_select') then
    create policy company_entitlements_select on company_entitlements for select to authenticated
      using (company_id = get_current_company_id());
  end if;
end $$;
grant select on company_entitlements to authenticated;

create or replace function company_can(p_company uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from company_entitlements where company_id = p_company and key = p_key and enabled)
$$;
revoke all on function company_can(uuid, text) from public, anon;
grant execute on function company_can(uuid, text) to authenticated, service_role;

create or replace function my_entitlements()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(key order by key), '{}')
    from company_entitlements where company_id = get_current_company_id() and enabled
$$;
revoke all on function my_entitlements() from public, anon;
grant execute on function my_entitlements() to authenticated;

create or replace function platform_studio_entitlements(p_company uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  return (select coalesce(array_agg(key order by key), '{}') from company_entitlements where company_id = p_company and enabled);
end;
$$;
revoke all on function platform_studio_entitlements(uuid) from public, anon;
grant execute on function platform_studio_entitlements(uuid) to authenticated;

create or replace function platform_set_entitlement(p_company uuid, p_key text, p_enabled boolean)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  if not exists (select 1 from companies where id = p_company) then
    raise exception 'unknown studio' using errcode = '42501';
  end if;
  insert into company_entitlements (company_id, key, enabled, updated_by)
  values (p_company, p_key, p_enabled, auth.uid())
  on conflict (company_id, key) do update set enabled = excluded.enabled, updated_at = now(), updated_by = excluded.updated_by;
  return platform_studio_entitlements(p_company);
end;
$$;
revoke all on function platform_set_entitlement(uuid, text, boolean) from public, anon;
grant execute on function platform_set_entitlement(uuid, text, boolean) to authenticated;

-- ── The studio's name on its emails (white_label) ────────────
create table if not exists company_branding (
  company_id  uuid primary key references companies (id) on delete cascade,
  from_name   text check (from_name is null or char_length(from_name) between 2 and 60),
  reply_to    text check (reply_to is null or (char_length(reply_to) <= 200 and reply_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  footer_line text check (footer_line is null or char_length(footer_line) <= 200),
  updated_at  timestamptz not null default now()
);
alter table company_branding enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'company_branding_select') then
    create policy company_branding_select on company_branding for select to authenticated
      using (company_id = get_current_company_id());
  end if;
  -- Writable only by an active member of a studio that has the tier; the API
  -- also limits it to owners and admins.
  if not exists (select 1 from pg_policies where policyname = 'company_branding_write') then
    create policy company_branding_write on company_branding for all to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id() and is_current_user_active() and company_can(company_id, 'white_label'));
  end if;
end $$;
grant select, insert, update on company_branding to authenticated;

-- ── What a sequence sent, or has waiting ─────────────────────
create table if not exists crm_sequence_sends (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  lead_id     uuid not null references crm_leads (id) on delete cascade,
  cadence_id  uuid not null references crm_cadences (id) on delete cascade,
  step_no     int not null,
  -- The enrollment this belongs to: a lead put back on the same sequence
  -- later gets its messages again, but one enrollment never gets one twice.
  enrolled_at timestamptz not null,
  channel     text not null check (channel in ('whatsapp', 'email')),
  subject     text,
  body        text not null,
  status      text not null default 'manual' check (status in ('queued', 'sending', 'manual', 'sent', 'skipped', 'failed')),
  attempts    int not null default 0,
  error       text,
  provider_id text,
  due_at      timestamptz not null default now(),
  sent_at     timestamptz,
  done_by     uuid,
  created_at  timestamptz not null default now(),
  unique (lead_id, cadence_id, step_no, enrolled_at)
);
create index if not exists crm_sequence_sends_open_idx on crm_sequence_sends (company_id, due_at) where status in ('manual', 'queued');
alter table crm_sequence_sends enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'crm_sequence_sends_select') then
    create policy crm_sequence_sends_select on crm_sequence_sends for select to authenticated
      using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'crm_sequence_sends_update') then
    create policy crm_sequence_sends_update on crm_sequence_sends for update to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id());
  end if;
end $$;
grant select, update on crm_sequence_sends to authenticated;

-- Can this studio send on this channel without a person? 0203 adds WhatsApp.
create or replace function crm_sequence_can_auto(p_company uuid, p_channel text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_channel
           when 'email' then company_can(p_company, 'sequences_auto')
           else false
         end
$$;
revoke all on function crm_sequence_can_auto(uuid, text) from public, anon;
grant execute on function crm_sequence_can_auto(uuid, text) to authenticated, service_role;

-- ── Starting and stopping ────────────────────────────────────
-- The one place a lead goes onto a sequence. Callers check who may do it.
create or replace function crm_sequence_begin(p_lead uuid, p_cadence uuid, p_actor uuid, p_why text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_name    text;
  v_step    crm_cadence_steps;
  v_next    timestamptz;
begin
  select company_id, name into v_company, v_name from crm_cadences where id = p_cadence;
  select * into v_step from crm_cadence_steps where cadence_id = p_cadence order by step_no limit 1;
  if not found then
    raise exception 'cadence has no steps' using errcode = '22023';
  end if;

  v_next := greatest(crm_sequence_step_at(now(), v_step.day_offset, v_step.send_hour), now() + interval '5 minutes');
  insert into crm_lead_cadences (lead_id, company_id, cadence_id, step_no, next_at)
  values (p_lead, v_company, p_cadence, v_step.step_no, v_next)
  on conflict (lead_id) do update
    set cadence_id = excluded.cadence_id, step_no = excluded.step_no, next_at = excluded.next_at,
        started_at = now(), completed_at = null, stopped_at = null, stopped_reason = null;

  -- A message step is not a call to make; only a reminder moves the follow-up.
  if v_step.channel = 'reminder' then
    update crm_leads set follow_up_at = v_next where id = p_lead;
  end if;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, p_lead, null, null, p_actor, coalesce(p_why, 'sequence started') || ': ' || v_name);
  return v_next;
end;
$$;
revoke all on function crm_sequence_begin(uuid, uuid, uuid, text) from public, anon, authenticated;

-- 0036's, now through crm_sequence_begin so the step lands at its hour.
create or replace function start_lead_cadence(p_lead uuid, p_cadence uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from crm_cadences where id = p_cadence and company_id = v_company and is_active) then
    raise exception 'unknown cadence' using errcode = '42501';
  end if;
  if not exists (select 1 from crm_leads where id = p_lead and company_id = v_company) then
    raise exception 'unknown lead' using errcode = '42501';
  end if;
  return crm_sequence_begin(p_lead, p_cadence, auth.uid(), 'sequence started');
end;
$$;
revoke all on function start_lead_cadence(uuid, uuid) from public, anon;
grant execute on function start_lead_cadence(uuid, uuid) to authenticated;

-- 0036's, now saying why.
create or replace function stop_lead_cadence(p_lead uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_name text;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update crm_lead_cadences lc
     set stopped_at = now(), stopped_reason = 'stopped'
   where lc.lead_id = p_lead and lc.company_id = v_company and lc.stopped_at is null and lc.completed_at is null
  returning (select name from crm_cadences where id = lc.cadence_id) into v_name;
  if not found then return false; end if;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, p_lead, null, null, auth.uid(), 'sequence stopped: ' || coalesce(v_name, ''));
  return true;
end;
$$;
revoke all on function stop_lead_cadence(uuid) from public, anon;
grant execute on function stop_lead_cadence(uuid) to authenticated;

-- 0036's: winning or losing ends it, now with the reason.
create or replace function crm_leads_stop_cadence_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('converted', 'lost') and old.status not in ('converted', 'lost') then
    update crm_lead_cadences set stopped_at = now(), stopped_reason = case when new.status = 'converted' then 'won' else 'lost' end
     where lead_id = new.id and stopped_at is null and completed_at is null;
  end if;
  return null;
end;
$$;

-- Whatever ends a sequence, what it had waiting is no longer owed.
create or replace function crm_lead_cadences_drop_waiting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stopped_at is not null and old.stopped_at is null then
    update crm_sequence_sends
       set status = 'skipped', error = 'Sequence stopped' || coalesce(' (' || new.stopped_reason || ')', '')
     where lead_id = new.lead_id and cadence_id = old.cadence_id and enrolled_at = old.started_at
       and status in ('manual', 'queued');
  end if;
  return null;
end;
$$;
drop trigger if exists crm_lead_cadences_drop_waiting on crm_lead_cadences;
create trigger crm_lead_cadences_drop_waiting after update of stopped_at on crm_lead_cadences
  for each row execute function crm_lead_cadences_drop_waiting();

-- They wrote back, or rang: a sequence stops talking -- unless it was set to
-- keep going. 0047's body; only the cadence update changed (stop_on_reply,
-- and the reason).
create or replace function crm_activities_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stopped text;
begin
  if new.lead_id is null then return null; end if;

  if new.type in ('call', 'email', 'meeting', 'whatsapp', 'sms') then
    if new.direction in ('in', 'out') then
      update crm_leads set last_contacted_at = coalesce(last_contacted_at, coalesce(new.started_at, new.created_at))
       where id = new.lead_id;
    end if;
    if new.direction = 'in' then
      update crm_lead_cadences lc
         set stopped_at = now(), stopped_reason = 'replied'
        from crm_cadences c
       where c.id = lc.cadence_id and c.stop_on_reply
         and lc.lead_id = new.lead_id and lc.stopped_at is null and lc.completed_at is null
      returning c.name into v_stopped;
      if v_stopped is not null then
        insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
        values (new.company_id, new.lead_id, null, null, null, 'replied via ' || new.type || ' · sequence stopped: ' || v_stopped);
      end if;
      update crm_workflow_enrollments e
         set status = 'exited', exit_reason = 'replied', next_at = null
        from crm_workflows w
       where w.id = e.workflow_id and e.lead_id = new.lead_id and e.status = 'active' and w.exit_on_reply;
    end if;
  end if;
  if pg_trigger_depth() <= 1 then
    perform crm_enroll_workflows(new.lead_id, 'activity_logged', new.type);
    perform crm_score_lead(new.lead_id);
  end if;
  return null;
end;
$$;

-- Sequences that start themselves. On a new lead: the most specific matching
-- one (stage, then source, then oldest). On a stage move: one written for
-- that stage, replacing whatever the lead was on.
create or replace function crm_leads_auto_sequence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cadence uuid;
begin
  if new.is_archived or new.merged_into is not null or new.status in ('converted', 'lost') then
    return null;
  end if;

  if tg_op = 'INSERT' then
    select c.id into v_cadence
      from crm_cadences c
     where c.company_id = new.company_id and c.is_active and c.auto_start
       and exists (select 1 from crm_cadence_steps s where s.cadence_id = c.id)
       and crm_cadence_matches_lead(c, new)
       and (new.source is distinct from 'csv_import' or c.source_filter = 'csv_import')
     order by (coalesce(c.stage_filter, '') <> '') desc, (coalesce(c.source_filter, '') <> '') desc, c.created_at
     limit 1;
  elsif new.stage_id is distinct from old.stage_id or new.status is distinct from old.status then
    select c.id into v_cadence
      from crm_cadences c
     where c.company_id = new.company_id and c.is_active and c.auto_start
       and coalesce(c.stage_filter, '') <> ''
       and exists (select 1 from crm_cadence_steps s where s.cadence_id = c.id)
       and crm_cadence_matches_lead(c, new)
       and not exists (select 1 from crm_lead_cadences lc
                        where lc.lead_id = new.id and lc.cadence_id = c.id and lc.stopped_at is null and lc.completed_at is null)
     order by (coalesce(c.source_filter, '') <> '') desc, c.created_at
     limit 1;
  end if;

  if v_cadence is not null then
    perform crm_sequence_begin(new.id, v_cadence, null, 'sequence started by itself');
  end if;
  return null;
end;
$$;
drop trigger if exists crm_leads_zz_auto_sequence on crm_leads;
create trigger crm_leads_zz_auto_sequence after insert or update on crm_leads
  for each row execute function crm_leads_auto_sequence();

-- ── The hourly sweep ─────────────────────────────────────────
-- 0151's body, with message steps: a WhatsApp or email step writes its
-- message into crm_sequence_sends -- queued when it can go by itself, waiting
-- in "Send now" when a person has to tap -- and the owner is told only when
-- they have something to do.
create or replace function crm_advance_cadences(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_next crm_cadence_steps;
  v_due int := 0;
  v_advanced int := 0;
  v_completed int := 0;
  v_written int := 0;
  v_next_at timestamptz;
  v_body text;
  v_to uuid;
  v_text text;
  v_status text;
  v_error text;
begin
  for v_r in
    select lc.lead_id, lc.company_id, lc.cadence_id, lc.step_no, lc.started_at,
           c.name as cadence_name, s.note, s.template_id, t.name as template_name,
           s.channel, s.subject, s.body as step_body, t.body as template_body,
           l.assigned_to, l.name as lead_name, l.phone, l.email
    from crm_lead_cadences lc
    join crm_cadences c on c.id = lc.cadence_id
    join crm_cadence_steps s on s.cadence_id = lc.cadence_id and s.step_no = lc.step_no
    join crm_leads l on l.id = lc.lead_id
    left join crm_templates t on t.id = s.template_id
    where lc.completed_at is null and lc.stopped_at is null and lc.next_at <= now()
      and l.is_archived = false and l.status not in ('converted', 'lost')
  loop
    v_due := v_due + 1;
    if p_dry_run then continue; end if;

    v_text := coalesce(nullif(trim(v_r.step_body), ''), v_r.template_body);
    v_to := crm_alert_recipient(v_r.company_id, v_r.assigned_to);

    if v_r.channel in ('whatsapp', 'email') and v_text is not null then
      v_error := case
                   when v_r.channel = 'whatsapp' and v_r.phone is null then 'No phone number'
                   when v_r.channel = 'email' and v_r.email is null then 'No email address'
                 end;
      v_status := case
                    when v_error is not null then 'skipped'
                    when crm_sequence_can_auto(v_r.company_id, v_r.channel) then 'queued'
                    else 'manual'
                  end;
      insert into crm_sequence_sends (company_id, lead_id, cadence_id, step_no, enrolled_at, channel, subject, body, status, error)
      values (v_r.company_id, v_r.lead_id, v_r.cadence_id, v_r.step_no, v_r.started_at, v_r.channel,
              v_r.subject, v_text, v_status, v_error)
      on conflict (lead_id, cadence_id, step_no, enrolled_at) do nothing;
      if found then v_written := v_written + 1; end if;

      if v_status = 'manual' and v_to is not null then
        perform create_notification(
          v_r.company_id, v_to, 'crm_sequence_send',
          'Send ' || case when v_r.channel = 'whatsapp' then 'WhatsApp' else 'email' end
            || ' to ' || coalesce(v_r.lead_name, v_r.phone, 'lead'),
          left(v_text, 140),
          'seqsend:' || v_r.lead_id::text || ':' || v_r.step_no::text || ':' || extract(epoch from v_r.started_at)::bigint::text,
          'crm_lead', v_r.lead_id);
      end if;
      insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
      values (v_r.company_id, v_r.lead_id, null, null, null,
              v_r.cadence_name || ' step ' || v_r.step_no || ': '
              || case v_status when 'queued' then v_r.channel || ' sending'
                               when 'manual' then v_r.channel || ' ready to send'
                               else v_r.channel || ' skipped (' || v_error || ')' end);
    else
      v_body := coalesce(v_r.note, '') || case when v_r.template_name is not null then ' · send "' || v_r.template_name || '"' else '' end;
      if v_to is not null then
        perform create_notification(
          v_r.company_id, v_to, 'crm_cadence',
          v_r.cadence_name || ' step ' || v_r.step_no || ': ' || coalesce(v_r.lead_name, v_r.phone, 'lead'),
          nullif(trim(v_body), ''),
          'cadence:' || v_r.lead_id::text || ':' || v_r.step_no::text,
          'crm_lead', v_r.lead_id);
      end if;
      insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
      values (v_r.company_id, v_r.lead_id, null, null, null,
              'cadence step ' || v_r.step_no || ' due' || case when v_r.note is not null then ': ' || v_r.note else '' end);
    end if;

    select * into v_next from crm_cadence_steps
     where cadence_id = v_r.cadence_id and step_no > v_r.step_no order by step_no limit 1;
    if found then
      v_next_at := greatest(crm_sequence_step_at(v_r.started_at, v_next.day_offset, v_next.send_hour), now() + interval '1 hour');
      update crm_lead_cadences set step_no = v_next.step_no, next_at = v_next_at where lead_id = v_r.lead_id;
      if v_next.channel = 'reminder' then
        update crm_leads set follow_up_at = v_next_at where id = v_r.lead_id;
      end if;
      v_advanced := v_advanced + 1;
    else
      update crm_lead_cadences set completed_at = now(), next_at = null where lead_id = v_r.lead_id;
      v_completed := v_completed + 1;
    end if;
  end loop;
  return jsonb_build_object('due', v_due, 'advanced', v_advanced, 'completed', v_completed, 'messages', v_written);
end;
$$;
revoke all on function crm_advance_cadences(boolean) from public, anon;
grant execute on function crm_advance_cadences(boolean) to service_role;

-- The sender takes queued messages: each is marked 'sending' as it is taken,
-- so two ticks never send the same one.
create or replace function crm_sequence_sends_claim(p_limit int default 50)
returns setof crm_sequence_sends
language sql
security definer
set search_path = public
as $$
  update crm_sequence_sends s
     set status = 'sending', attempts = s.attempts + 1
   where s.id in (
     select id from crm_sequence_sends
      where status = 'queued' and due_at <= now()
      order by due_at
      limit greatest(1, least(p_limit, 200))
      for update skip locked)
  returning s.*
$$;
revoke all on function crm_sequence_sends_claim(int) from public, anon, authenticated;
grant execute on function crm_sequence_sends_claim(int) to service_role;

-- ── Starter sequences for a photography studio ───────────────
-- Added on request from the Sequences page, switched off; the studio reads
-- them, edits the words, and turns on the ones it wants.
create or replace function crm_add_starter_sequences()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id uuid;
  v_added int := 0;
  v_seq jsonb;
  v_step jsonb;
  v_no int;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for v_seq in select * from jsonb_array_elements($j$[
    {"key": "new_enquiry", "name": "New enquiry",
     "description": "Say hello the same day, share packages the next, and check in before they go cold.",
     "steps": [
       {"day": 0, "channel": "whatsapp", "hour": 10,
        "body": "Hi {{first_name}}, thank you for reaching out to {{studio}}! We would love to hear about your {{event_type}}. You can see our work here: {{website}}\n\nWhen is a good time for a quick call?"},
       {"day": 1, "channel": "email", "hour": 11, "subject": "Our packages for your {{event_type}}",
        "body": "Hi {{first_name}},\n\nThank you for considering {{studio}} for your {{event_type}}. Here is a look at our work: {{website}}\n\nReply to this email with your date and venue, and we will send you a quotation that fits.\n\nWarm regards,\n{{studio}}"},
       {"day": 3, "channel": "whatsapp", "hour": 18,
        "body": "Hi {{first_name}}, just checking in. Are you still deciding on a photographer for your {{event_type}}? Happy to answer any questions."},
       {"day": 7, "channel": "reminder", "hour": 11, "note": "Call them: last try before marking the lead cold"}
     ]},
    {"key": "quotation_sent", "name": "Quotation sent",
     "description": "Follow a quotation until they decide.",
     "steps": [
       {"day": 2, "channel": "whatsapp", "hour": 11,
        "body": "Hi {{first_name}}, did you get a chance to look at the quotation from {{studio}}? Happy to walk you through it or adjust anything."},
       {"day": 5, "channel": "email", "hour": 11, "subject": "About your quotation from {{studio}}",
        "body": "Hi {{first_name}},\n\nJust following up on the quotation we sent for your {{event_type}}. Dates fill up quickly in the season, so do let us know if you would like us to hold yours.\n\nWarm regards,\n{{studio}}"},
       {"day": 8, "channel": "reminder", "hour": 11, "note": "Call about the quotation"}
     ]},
    {"key": "after_shoot", "name": "After the shoot",
     "description": "Thank them, then ask for a review and referrals.",
     "steps": [
       {"day": 1, "channel": "whatsapp", "hour": 12,
        "body": "Hi {{first_name}}, thank you for having {{studio}} at your {{event_type}}! It was a pleasure. We will share your photos soon."},
       {"day": 14, "channel": "whatsapp", "hour": 12,
        "body": "Hi {{first_name}}, we hope you loved your photos! If you have a minute, a review would mean a lot to us. And if friends are planning an event, we would be grateful for a mention."}
     ]}
  ]$j$::jsonb)
  loop
    if exists (select 1 from crm_cadences where company_id = v_company and starter_key = v_seq->>'key') then
      continue;
    end if;
    insert into crm_cadences (company_id, name, description, is_active, auto_start, starter_key)
    values (v_company, v_seq->>'name', v_seq->>'description', true, false, v_seq->>'key')
    returning id into v_id;
    v_no := 0;
    for v_step in select * from jsonb_array_elements(v_seq->'steps') loop
      v_no := v_no + 1;
      insert into crm_cadence_steps (cadence_id, company_id, step_no, day_offset, channel, send_hour, subject, body, note)
      values (v_id, v_company, v_no, (v_step->>'day')::int, v_step->>'channel', (v_step->>'hour')::int,
              v_step->>'subject', v_step->>'body', v_step->>'note');
    end loop;
    v_added := v_added + 1;
  end loop;
  return v_added;
end;
$$;
revoke all on function crm_add_starter_sequences() from public, anon;
grant execute on function crm_add_starter_sequences() to authenticated;
