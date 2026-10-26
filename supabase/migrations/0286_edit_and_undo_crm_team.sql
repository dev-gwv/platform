-- 0286: leads, team and settings can be changed back (owner, 26 Oct: "once
-- something is created, people cannot edit it back or undo it ... they should
-- be able to undo it or change it whenever it is required").
--
-- Safe to run twice: every table and column is `if not exists`, every
-- function `create or replace` with an unchanged argument list, every trigger
-- dropped first.
--
--  1. Undo a booking.  crm_unbook_lead(lead) clears converted_project_id /
--     converted_client_id / converted_at and puts the lead back on its
--     pipeline's first open stage. The project and the client stay; the
--     project is deleted from its own page if it should go. 0149's guard
--     ("already converted") reads those two columns, so the lead can be
--     booked again afterwards.
--  2. Revise a sent quote.  duplicate_quote(quote) copies any quote, lines and
--     all (unit and days from 0265), into a new draft with the next number.
--  3. Reopening an accepted quote puts the deal value back.  Accepting
--     overwrote crm_leads.deal_value with the quote's total (0049, 0151) and
--     nothing remembered what it was; crm_quotes now keeps it
--     (deal_value_before) by trigger, and reopening restores it -- only while
--     the lead still shows the quote's total, never over a number typed since.
--  4. A call's outcome can be changed, and a call deleted.  0201 counted an
--     outcome once, on the way in; a changed or removed call now recounts the
--     lead's calls from scratch (crm_recount_calls), so attempts, the last
--     outcome and contacted/unreachable follow what is really logged.
--  5. "Not duplicates" is remembered.  0107's keep_separate wrote a note and
--     crm_duplicate_groups never read it, so the same pair came back. The pair
--     is kept in crm_duplicate_dismissals and left out of the groups; it can
--     be listed and undone.
--  6. Turn a login off.  users.sign_in_off: the person stays on the team (crew,
--     payroll, history) but cannot sign in; list_login_profiles (0159) and
--     get_auth_context (0219) are copied with the one extra condition. Setting
--     their sign-in again (Sign-in details) turns it back on.
--  7. Change a leave decision.  reopen_leave(id, note): a manager puts a
--     decided request back to waiting; a split (0228) is joined up again and
--     a request made unpaid gets its asked-for kind back (asked_kind, kept by
--     trigger from now on). Absent marks the approval removed are not put
--     back -- they were an absence or not, and the register can say so.
--     update_leave_request(...): whoever asked edits their own waiting request.
--  8. Take back an attendance-fix request.  cancel_attendance_correction(id)
--     removes your own waiting request.
--  9. Clear an attendance mark.  set_attendance_manual (copied from 0224)
--     takes 'none', which removes the day's row.

-- ══════════════════════════════════════════════════════════════
-- 1. Undo a booking
-- ══════════════════════════════════════════════════════════════
create or replace function crm_unbook_lead(p_lead uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_lead    crm_leads;
  v_stage   uuid;
  v_project text;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_lead from crm_leads where id = p_lead and company_id = v_company;
  if not found then
    raise exception 'unknown lead' using errcode = '42501';
  end if;
  if v_lead.converted_project_id is null and v_lead.converted_client_id is null and v_lead.status <> 'converted' then
    raise exception 'This lead is not booked.' using errcode = 'P0001';
  end if;
  select s.id into v_stage
    from crm_pipeline_stages s
   where s.pipeline_id = v_lead.pipeline_id and s.kind = 'open' and coalesce(s.is_active, true)
   order by s.position, s.created_at
   limit 1;
  if v_stage is null then
    select s.id into v_stage
      from crm_pipeline_stages s
     where s.pipeline_id = v_lead.pipeline_id and s.kind = 'open'
     order by s.position, s.created_at
     limit 1;
  end if;
  if v_stage is null then
    raise exception 'This pipeline has no open stage to put the lead back on.' using errcode = 'P0001';
  end if;
  select name into v_project from projects where id = v_lead.converted_project_id;

  -- The stage decides the status (crm_leads_sync), so the lead reads open again.
  update crm_leads
     set converted_project_id = null,
         converted_client_id  = null,
         converted_at         = null,
         stage_id             = v_stage
   where id = p_lead;

  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, p_lead, null, null, auth.uid(),
          'booking undone' || coalesce(' (project ' || v_project || ' kept)', ''));
  return v_stage;
end;
$$;
revoke all on function crm_unbook_lead(uuid) from public, anon;
grant execute on function crm_unbook_lead(uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 2. Revise a quote: a new draft from any quote
-- ══════════════════════════════════════════════════════════════
create or replace function duplicate_quote(p_quote uuid)
returns table (id uuid, quote_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_q       crm_quotes;
  v_number  text;
  v_id      uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_q from crm_quotes q where q.id = p_quote and q.company_id = v_company;
  if not found then
    raise exception 'unknown quote' using errcode = '42501';
  end if;
  v_number := next_quote_number();
  insert into crm_quotes (company_id, lead_id, contact_id, quote_number, title, valid_until, place_of_supply, intra_state,
                          subtotal, discount, taxable, tax, total, notes, terms, created_by)
  values (v_company, v_q.lead_id, v_q.contact_id, v_number, v_q.title,
          -- A date already gone would make the new draft expired on arrival.
          case when v_q.valid_until >= current_date then v_q.valid_until end,
          v_q.place_of_supply, v_q.intra_state,
          v_q.subtotal, v_q.discount, v_q.taxable, v_q.tax, v_q.total, v_q.notes, v_q.terms, auth.uid())
  returning crm_quotes.id into v_id;

  insert into crm_quote_items (quote_id, company_id, description, quantity, rate, amount, gst_rate, taxable,
                               cgst, sgst, igst, sort_order, unit, days)
  select v_id, v_company, i.description, i.quantity, i.rate, i.amount, i.gst_rate, i.taxable,
         i.cgst, i.sgst, i.igst, i.sort_order, i.unit, i.days
    from crm_quote_items i
   where i.quote_id = p_quote;

  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, v_q.lead_id, null, null, auth.uid(),
          'quote ' || v_q.quote_number || ' revised as ' || v_number);
  return query select v_id, v_number;
end;
$$;
revoke all on function duplicate_quote(uuid) from public, anon;
grant execute on function duplicate_quote(uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 3. Reopening an accepted quote puts the deal value back
-- ══════════════════════════════════════════════════════════════
alter table crm_quotes
  add column if not exists deal_value_before numeric(12, 2),
  add column if not exists deal_value_saved  boolean not null default false;

create or replace function crm_quotes_keep_deal_value()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_back numeric;
  v_have boolean := false;
begin
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    -- Both accept paths write the quote before the lead, so this is the
    -- value from before the acceptance.
    select l.deal_value into new.deal_value_before from crm_leads l where l.id = new.lead_id;
    new.deal_value_saved := true;
  elsif old.status = 'accepted' and new.status is distinct from 'accepted' then
    if old.deal_value_saved then
      v_back := old.deal_value_before;
      v_have := true;
    else
      -- Accepted before 0286: fall back on another accepted quote's total.
      select q.total into v_back
        from crm_quotes q
       where q.lead_id = new.lead_id and q.id <> new.id and q.status = 'accepted'
       order by q.accepted_at desc nulls last
       limit 1;
      v_have := found;
    end if;
    if v_have then
      -- Only while the lead still shows this quote's total: a number someone
      -- typed since is theirs, not ours to undo.
      update crm_leads set deal_value = v_back
       where id = new.lead_id and deal_value is not distinct from old.total;
    end if;
    new.deal_value_before := null;
    new.deal_value_saved := false;
  end if;
  return new;
end;
$$;
drop trigger if exists crm_quotes_keep_deal_value on crm_quotes;
create trigger crm_quotes_keep_deal_value before update of status on crm_quotes
  for each row execute function crm_quotes_keep_deal_value();

-- ══════════════════════════════════════════════════════════════
-- 4. A call's outcome can change; a call can go
-- ══════════════════════════════════════════════════════════════
-- Replays every call with an outcome, oldest first, by 0201's rule.
create or replace function crm_recount_calls(p_lead uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r          record;
  v_attempts int := 0;
  v_state    text := null;
  v_last_at  timestamptz := null;
  v_last     text := null;
begin
  for r in
    select a.outcome, coalesce(a.started_at, a.created_at) as at
      from crm_activities a
     where a.lead_id = p_lead and a.type = 'call' and a.outcome is not null
     order by coalesce(a.started_at, a.created_at), a.created_at
  loop
    v_last_at := r.at;
    v_last := r.outcome;
    if r.outcome in ('no_answer', 'busy', 'switched_off', 'voicemail') then
      v_attempts := v_attempts + 1;
      if v_attempts >= 3 then v_state := 'unreachable'; end if;
    elsif r.outcome = 'wrong_number' then
      v_state := 'unreachable';
    else
      v_attempts := 0;
      v_state := 'contacted';
    end if;
  end loop;

  update crm_leads l
     set call_attempts     = v_attempts,
         last_call_at      = v_last_at,
         last_call_outcome = v_last,
         contacted_status  = coalesce(v_state,
                               case when l.last_contacted_at is not null or l.status <> 'new'
                                    then 'contacted' else 'uncontacted' end)
   where l.id = p_lead;
end;
$$;
revoke all on function crm_recount_calls(uuid) from public, anon, authenticated;

-- Copied from 0201 with the two new paths: an outcome changed, or the call
-- removed (or moved off the lead), recounts instead of adding.
create or replace function crm_call_outcome_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missed boolean;
begin
  if tg_op = 'DELETE' then
    if old.lead_id is not null and old.type = 'call' and old.outcome is not null then
      perform crm_recount_calls(old.lead_id);
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' and old.type = 'call' and old.outcome is not null
     and (new.outcome is distinct from old.outcome or new.lead_id is distinct from old.lead_id
          or new.type is distinct from old.type) then
    if old.lead_id is not null then perform crm_recount_calls(old.lead_id); end if;
    if new.lead_id is not null and new.lead_id is distinct from old.lead_id then
      perform crm_recount_calls(new.lead_id);
    end if;
    return null;
  end if;

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
  after insert or update of outcome, lead_id, type on crm_activities
  for each row execute function crm_call_outcome_apply();
drop trigger if exists crm_activities_zz_call_outcome_delete on crm_activities;
create trigger crm_activities_zz_call_outcome_delete
  after delete on crm_activities
  for each row execute function crm_call_outcome_apply();

-- ══════════════════════════════════════════════════════════════
-- 5. "Not duplicates" is remembered, and can be undone
-- ══════════════════════════════════════════════════════════════
create table if not exists crm_duplicate_dismissals (
  company_id uuid not null references companies (id) on delete cascade,
  lead_a     uuid not null references crm_leads (id) on delete cascade,
  lead_b     uuid not null references crm_leads (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (lead_a, lead_b),
  check (lead_a < lead_b)
);
create index if not exists crm_duplicate_dismissals_company_idx on crm_duplicate_dismissals (company_id, created_at desc);
alter table crm_duplicate_dismissals enable row level security;
drop policy if exists crm_duplicate_dismissals_select on crm_duplicate_dismissals;
create policy crm_duplicate_dismissals_select on crm_duplicate_dismissals
  for select to authenticated using (company_id = get_current_company_id());
grant select on crm_duplicate_dismissals to authenticated;

-- Copied from 0107; a group whose every pair was called "not duplicates"
-- stays away. A new lead with the same number makes a new pair, so it shows.
create or replace function crm_duplicate_groups()
returns table (phone_norm text, match_type text, match_value_masked text,
               lead_ids uuid[], lead_count int, leads jsonb)
language sql
security definer
set search_path = public
as $$
  with phone_groups as (
    select l.phone_norm as key, 'phone'::text as mtype,
           array_agg(l.id order by l.created_at) as ids, count(*)::int as n
    from crm_leads l
    where l.company_id = get_current_company_id()
      and l.phone_norm is not null and l.is_archived = false
    group by l.phone_norm having count(*) > 1
  ),
  email_groups as (
    select lower(l.email) as key, 'email'::text as mtype,
           array_agg(l.id order by l.created_at) as ids, count(*)::int as n
    from crm_leads l
    where l.company_id = get_current_company_id()
      and nullif(trim(l.email), '') is not null and l.is_archived = false
    group by lower(l.email) having count(*) > 1
  ),
  all_groups as (
    select * from phone_groups
    union all
    select * from email_groups
  ),
  groups as (
    select g.* from all_groups g
     where exists (
       select 1
         from unnest(g.ids) a(id)
         cross join unnest(g.ids) b(id)
        where a.id < b.id
          and not exists (select 1 from crm_duplicate_dismissals d where d.lead_a = a.id and d.lead_b = b.id))
     order by g.n desc limit 50
  )
  select g.key, g.mtype,
         case when g.mtype = 'phone'
              then '••••••' || right(regexp_replace(g.key, '\D', '', 'g'), 4)
              else left(split_part(g.key, '@', 1), 2) || '•••@' || split_part(g.key, '@', 2) end,
         g.ids, g.n,
         (select jsonb_agg(jsonb_build_object(
            'id', l.id, 'name', l.name, 'phone', l.phone, 'email', l.email,
            'quality', l.quality, 'contacted_status', l.contacted_status,
            'assigned_to', l.assigned_to, 'assignee_name', u.name,
            'status', l.status, 'source', l.source,
            'created_at', l.created_at, 'notes', l.notes
          ) order by l.created_at)
          from crm_leads l left join users u on u.user_id = l.assigned_to
          where l.id = any(g.ids))
  from groups g;
$$;
revoke all on function crm_duplicate_groups() from public, anon;
grant execute on function crm_duplicate_groups() to authenticated;

-- Copied from 0107; keep_separate now writes down every pair it covers.
create or replace function resolve_crm_duplicates(p_survivor uuid, p_duplicates uuid[], p_action text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id uuid;
  v_n int := 0;
  v_all uuid[];
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action not in ('keep_separate', 'archive') then
    raise exception 'unknown resolve action' using errcode = '22023';
  end if;
  if not exists (select 1 from crm_leads where id = p_survivor and company_id = v_company) then
    raise exception 'unknown survivor' using errcode = '42501';
  end if;
  foreach v_id in array p_duplicates loop
    if v_id = p_survivor then continue; end if;
    if not exists (select 1 from crm_leads where id = v_id and company_id = v_company and is_archived = false) then
      continue;
    end if;
    if p_action = 'archive' then
      update crm_leads set is_archived = true, archived_at = now(), merged_into = p_survivor
       where id = v_id and company_id = v_company;
    end if;
    insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
    values (v_company, p_survivor, null, null, auth.uid(),
            case when p_action = 'archive' then 'archived duplicate ' || v_id::text
                 else 'kept separate from ' || v_id::text end);
    v_n := v_n + 1;
  end loop;

  if p_action = 'keep_separate' then
    v_all := array(select distinct x from unnest(array_append(p_duplicates, p_survivor)) x
                    where exists (select 1 from crm_leads l where l.id = x and l.company_id = v_company));
    insert into crm_duplicate_dismissals (company_id, lead_a, lead_b, created_by)
    select v_company, least(a, b), greatest(a, b), auth.uid()
      from unnest(v_all) a cross join unnest(v_all) b
     where a < b
    on conflict do nothing;
  end if;
  return v_n;
end;
$$;

-- The pairs set aside, newest first, with both names to recognise them by.
create or replace function crm_duplicate_dismissed()
returns table (lead_a uuid, name_a text, lead_b uuid, name_b text, matched_on text, dismissed_by text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select d.lead_a, coalesce(a.name, a.phone, a.email, 'Unnamed lead'),
         d.lead_b, coalesce(b.name, b.phone, b.email, 'Unnamed lead'),
         case when a.phone_norm is not null and a.phone_norm = b.phone_norm then 'phone' else 'email' end,
         u.name, d.created_at
    from crm_duplicate_dismissals d
    join crm_leads a on a.id = d.lead_a
    join crm_leads b on b.id = d.lead_b
    left join users u on u.user_id = d.created_by
   where d.company_id = get_current_company_id()
   order by d.created_at desc
   limit 200
$$;
revoke all on function crm_duplicate_dismissed() from public, anon;
grant execute on function crm_duplicate_dismissed() to authenticated;

create or replace function crm_undo_duplicate_dismissal(p_a uuid, p_b uuid)
returns boolean
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
  delete from crm_duplicate_dismissals
   where company_id = v_company and lead_a = least(p_a, p_b) and lead_b = greatest(p_a, p_b);
  return found;
end;
$$;
revoke all on function crm_undo_duplicate_dismissal(uuid, uuid) from public, anon;
grant execute on function crm_undo_duplicate_dismissal(uuid, uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 6. Turn a login off
-- ══════════════════════════════════════════════════════════════
alter table users add column if not exists sign_in_off boolean not null default false;

-- Copied from 0159 with `not u.sign_in_off`.
create or replace function list_login_profiles(p_identity uuid)
returns table (
  profile_id   uuid,
  company_id   uuid,
  company_name text,
  role         app_role,
  is_owner     boolean,
  display_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select u.user_id, u.company_id, c.name, u.role, (c.owner_user_id = u.user_id), u.name
    from users u
    join companies c on c.id = u.company_id
    join auth.users au on au.id = u.user_id
   where (au.id = p_identity or (au.identity_id = p_identity and u.login_enabled))
     and u.deleted_at is null
     and u.status = 'active'
     and not u.sign_in_off
   order by lower(c.name), u.user_id
$$;
revoke all on function list_login_profiles(uuid) from public, anon, authenticated;
grant execute on function list_login_profiles(uuid) to service_role;

-- Copied from 0219 with `not u.sign_in_off`.
create or replace function get_auth_context()
returns table (
  company_id          uuid,
  role                app_role,
  is_owner            boolean,
  is_platform_admin   boolean,
  display_name        text,
  email               text,
  plan_expiry         timestamptz,
  plan_gate           text,
  profile_key         text,
  overrides           jsonb,
  password_changed_at timestamptz,
  password_version    integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.company_id,
    u.role,
    (c.owner_user_id = u.user_id) as is_owner,
    exists (select 1 from platform_admins pa where pa.user_id in (u.user_id, coalesce(au.identity_id, au.id))) as is_platform_admin,
    u.name                        as display_name,
    u.email,
    c.plan_expiry,
    case
      when coalesce(c.plan_expiry,         'epoch'::timestamptz) > now() then 'active'
      when coalesce(c.grandfathered_until, 'epoch'::timestamptz) > now() then 'grandfathered'
      when coalesce(c.grace_until,         'epoch'::timestamptz) > now() then 'grace'
      else 'expired'
    end                           as plan_gate,
    (
      select a.profile_key from user_access_assignments a
      where a.user_id = u.user_id and a.is_active
      limit 1
    )                             as profile_key,
    coalesce((
      select jsonb_agg(jsonb_build_object('permission_key', o.permission_key, 'enabled', o.enabled))
      from user_access_overrides o where o.user_id = u.user_id
    ), '[]'::jsonb)               as overrides,
    idn.password_changed_at,
    idn.password_version
  from users u
  join companies c on c.id = u.company_id
  join auth.users au on au.id = u.user_id
  join auth.users idn on idn.id = coalesce(au.identity_id, au.id)
  where u.user_id = auth.uid()
    and u.deleted_at is null
    and u.status = 'active'
    and (au.identity_id is null or u.login_enabled)
    and not u.sign_in_off
$$;
revoke all on function get_auth_context() from public, anon;
grant execute on function get_auth_context() to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 7. Change a leave decision; edit a waiting request
-- ══════════════════════════════════════════════════════════════
alter table leave_requests add column if not exists asked_kind text;

-- decide_leave (0228) turns a request unpaid in place; the kind asked for is
-- kept the first time it changes, so a reopened request can have it back.
create or replace function leave_requests_keep_asked_kind()
returns trigger
language plpgsql
as $$
begin
  if new.kind is distinct from old.kind and old.asked_kind is null and new.status <> 'pending' then
    new.asked_kind := old.kind;
  end if;
  return new;
end;
$$;
drop trigger if exists leave_requests_keep_asked_kind on leave_requests;
create trigger leave_requests_keep_asked_kind before update of kind on leave_requests
  for each row execute function leave_requests_keep_asked_kind();

create or replace function reopen_leave(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r     leave_requests;
  v_split leave_requests;
begin
  if not (is_current_user_active() and is_current_admin_or_manager()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_r from leave_requests where id = p_id and company_id = get_current_company_id() for update;
  if not found then
    raise exception 'leave request not found' using errcode = 'P0002';
  end if;
  if v_r.status not in ('approved', 'rejected') then
    raise exception 'only a decided request can be reopened' using errcode = '22023';
  end if;
  if v_r.user_id = auth.uid() and not is_current_owner() then
    raise exception 'someone else has to decide your own leave' using errcode = '42501';
  end if;

  -- 0228's split: the unpaid rest was written in the same moment, by the
  -- same person, starting the day after this request now ends.
  if v_r.status = 'approved' then
    select * into v_split from leave_requests
     where company_id = v_r.company_id and user_id = v_r.user_id and id <> v_r.id
       and kind = 'unpaid' and status = 'approved'
       and start_date = v_r.end_date + 1
       and decided_at = v_r.decided_at and decided_by is not distinct from v_r.decided_by
     limit 1;
    if found then
      delete from leave_requests where id = v_split.id;
      v_r.end_date := v_split.end_date;
    end if;
  end if;

  update leave_requests
     set status = 'pending',
         end_date = v_r.end_date,
         kind = coalesce(asked_kind, kind),
         asked_kind = null,
         decided_by = null, decided_at = null, decision_note = null
   where id = p_id;

  perform create_notification(
    v_r.company_id, v_r.user_id, 'leave.decided', 'Your leave is being looked at again',
    to_char(v_r.start_date, 'DD Mon') || case when v_r.end_date > v_r.start_date then ' – ' || to_char(v_r.end_date, 'DD Mon') else '' end
      || coalesce(' · ' || nullif(btrim(p_note), ''), ''),
    'leave_reopened:' || p_id || ':' || extract(epoch from now())::bigint, 'leave', p_id, 'info', '/leave');
end;
$$;
revoke all on function reopen_leave(uuid, text) from public, anon;
grant execute on function reopen_leave(uuid, text) to authenticated;

create or replace function update_leave_request(
  p_id uuid, p_kind text, p_start date, p_end date, p_half_day boolean, p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from leave_requests where id = p_id and user_id = v_me and status = 'pending') then
    raise exception 'only your own waiting request can be changed' using errcode = '22023';
  end if;
  if p_end < p_start then
    raise exception 'the leave ends before it starts' using errcode = '22023';
  end if;
  if p_start < (now() at time zone 'Asia/Kolkata')::date - 30 then
    raise exception 'leave can be asked for up to 30 days back' using errcode = '22023';
  end if;
  if exists (
    select 1 from leave_requests
     where user_id = v_me and id <> p_id and status in ('pending', 'approved')
       and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')
  ) then
    raise exception 'you already have leave on some of these days' using errcode = '22023';
  end if;
  update leave_requests
     set kind = coalesce(p_kind, kind), start_date = p_start, end_date = p_end,
         half_day = coalesce(p_half_day, false), reason = nullif(btrim(p_reason), '')
   where id = p_id;
end;
$$;
revoke all on function update_leave_request(uuid, text, date, date, boolean, text) from public, anon;
grant execute on function update_leave_request(uuid, text, date, date, boolean, text) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 8. Take back an attendance-fix request
-- ══════════════════════════════════════════════════════════════
create or replace function cancel_attendance_correction(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from attendance_corrections
   where id = p_id and user_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'that request was already answered' using errcode = '22023';
  end if;
  -- Nobody needs to look at it any more.
  update notifications set read_at = now()
   where entity_type = 'attendance' and entity_id = p_id and read_at is null;
end;
$$;
revoke all on function cancel_attendance_correction(uuid) from public, anon;
grant execute on function cancel_attendance_correction(uuid) to authenticated;

-- ══════════════════════════════════════════════════════════════
-- 9. Clear an attendance mark ('none'); copied from 0224
-- ══════════════════════════════════════════════════════════════
create or replace function set_attendance_manual(
  p_user_id      uuid,
  p_date         date,
  p_status       text,
  p_check_in_at  timestamptz default null,
  p_check_out_at timestamptz default null,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not (is_current_owner() or current_app_role() = 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status not in ('present', 'late', 'half_day', 'absent', 'none') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  if p_check_in_at is not null and p_check_out_at is not null and p_check_out_at < p_check_in_at then
    raise exception 'check-out before check-in' using errcode = '22023';
  end if;
  if not exists (select 1 from users where user_id = p_user_id and company_id = v_company and deleted_at is null) then
    raise exception 'unknown_member' using errcode = 'P0001';
  end if;

  -- No mark: the day was marked by mistake. The row goes; the audit trail
  -- (the API's) keeps who cleared it.
  if p_status = 'none' then
    delete from attendance
     where company_id = v_company and user_id = p_user_id and a_date = p_date
    returning id into v_id;
    return v_id;
  end if;

  insert into attendance (company_id, user_id, a_date, status, check_in_at, check_out_at, corrected_by, correction_note)
  values (v_company, p_user_id, p_date, p_status, p_check_in_at, p_check_out_at, auth.uid(), p_note)
  on conflict (company_id, user_id, a_date) do update
    set status = excluded.status,
        check_in_at = excluded.check_in_at,
        check_out_at = excluded.check_out_at,
        corrected_by = excluded.corrected_by,
        correction_note = excluded.correction_note
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function set_attendance_manual(uuid, date, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function set_attendance_manual(uuid, date, text, timestamptz, timestamptz, text) to authenticated;
