-- 0314: audit fixes (21 Nov). Money and database findings from the audit.
--
-- 1. No money on a draft or cancelled invoice: a BEFORE trigger on
--    received_payments refuses a payment put on (or moved onto) one, 23514,
--    "invoice is still a draft" / "invoice is cancelled" -- the API answers
--    409 in words. Every app path already sends a draft before paying it
--    (create and edit set it to sent first, the invoice page sends it), so
--    this only shuts the doors that did not check. Only a change of invoice
--    is checked, so a payment already on such an invoice can still be edited.
-- 2. The old app's paid time carries over only to the owner's own login, and
--    only once that inbox is proven (auth.users.email_proven_at, 0294): an
--    admin a studio adds, or a login with a typed-in email, never claims
--    another studio's paid time. legacy_carry_over copied from 0218 (its
--    only definition) and changed where it says; it also runs the moment
--    an owner's inbox becomes proven (trigger on auth.users).
-- 3. Indexes for the foreign keys the audit found unindexed.
-- 4. prune_usage_events(): usage_events grew forever. It drops rows older
--    than 90 days (flow rows, read by "Where people stop" up to a year, after
--    365), always keeping each person's and each studio's newest row so
--    "last seen" never goes blank. Not on the cron here; the cron wires it.
-- 5. india_today(): "today" in India. The date columns that defaulted to
--    current_date (UTC on the server, still yesterday until 5:30 am IST)
--    default to it now.
--
-- Safe to run twice: create or replace with the same argument lists,
-- drop trigger if exists, create index if not exists, set default.

-- ── 5 first: india_today, used by the defaults below ───────────────
create or replace function india_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;
grant execute on function india_today() to authenticated, service_role;

alter table invoices              alter column invoice_date set default india_today();
alter table received_payments     alter column paid_on      set default india_today();
alter table expenses              alter column expense_date set default india_today();
alter table team_slot_settlements alter column paid_date    set default india_today();


-- ── 1. no money on a draft or cancelled invoice ────────────────────
create or replace function received_payments_invoice_open()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if new.invoice_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.invoice_id is not distinct from old.invoice_id then
    return new;
  end if;
  select status into v_status from invoices where id = new.invoice_id;
  if v_status = 'cancelled' then
    raise exception 'this invoice is cancelled; reopen it before taking a payment on it'
      using errcode = '23514';
  elsif v_status = 'draft' then
    raise exception 'this invoice is still a draft; send it before taking a payment on it'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists received_payments_invoice_open on received_payments;
create trigger received_payments_invoice_open
  before insert or update of invoice_id on received_payments
  for each row execute function received_payments_invoice_open();


-- ── 2. legacy carry-over: the owner's own proven inbox only ────────
-- Copied from 0218. Changed: the match is the owner's login email (the
-- identity behind companies.owner_user_id), and only once that login's
-- inbox is proven. 0218 matched any owner or admin row's typed email.
create or replace function legacy_carry_over(p_company uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
  v_count integer;
begin
  with owner_login as (
    select lower(trim(au.email)) as email
      from companies c
      join auth.users au on au.id = auth_identity_of(c.owner_user_id)
     where c.id = p_company
       and au.email_proven_at is not null
       and au.email is not null
  ), matched as (
    select l.id, l.expires_at
      from legacy_studios l
      join owner_login o on o.email = l.email
     where l.joined_company_id is null
       and l.email is not null
  ), marked as (
    update legacy_studios l
       set joined_company_id = p_company, carried_at = now()
      from matched m
     where l.id = m.id
    returning m.expires_at
  )
  select count(*)::int, max((expires_at + 1)::timestamptz) filter (where expires_at >= india_today())
    into v_count, v_until
    from marked;

  if v_until is not null then
    update companies
       set plan_expiry = greatest(coalesce(plan_expiry, '-infinity'::timestamptz), v_until)
     where id = p_company;
  end if;
  return coalesce(v_count, 0);
end;
$$;
revoke all on function legacy_carry_over(uuid) from public, anon, authenticated;
grant execute on function legacy_carry_over(uuid) to service_role;

-- Copied from 0218. Changed: only the owner's own row is worth a look (the
-- function checks the inbox proof itself).
create or replace function users_legacy_carry_over()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from companies c where c.id = new.company_id and c.owner_user_id = new.user_id) then
    perform legacy_carry_over(new.company_id);
  end if;
  return null;
end;
$$;
drop trigger if exists users_legacy_carry_over on users;
create trigger users_legacy_carry_over after insert on users
  for each row execute function users_legacy_carry_over();

-- The moment an inbox is proven (confirmation link, password reset, Google),
-- every studio that login owns takes its old paid time.
create or replace function auth_users_legacy_carry_over()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  if new.email_proven_at is null or old.email_proven_at is not null then
    return null;
  end if;
  if not exists (select 1 from legacy_studios l
                  where l.joined_company_id is null and l.email = lower(trim(new.email))) then
    return null;
  end if;
  for v_company in
    select c.id from companies c where auth_identity_of(c.owner_user_id) = new.id
  loop
    perform legacy_carry_over(v_company);
  end loop;
  return null;
end;
$$;
drop trigger if exists auth_users_legacy_carry_over on auth.users;
create trigger auth_users_legacy_carry_over after update of email_proven_at on auth.users
  for each row execute function auth_users_legacy_carry_over();


-- ── 3. indexes ─────────────────────────────────────────────────────
create index if not exists team_work_submissions_project_idx on team_work_submissions (project_id);
create index if not exists tasks_parent_task_idx on tasks (parent_task_id) where parent_task_id is not null;
create index if not exists team_slot_settlements_project_idx on team_slot_settlements (project_id);
create index if not exists invoices_client_idx on invoices (client_id);
create index if not exists crm_leads_company_assigned_idx on crm_leads (company_id, assigned_to);


-- ── 4. prune usage_events ──────────────────────────────────────────
create or replace function prune_usage_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with newest_user as (
    select distinct on (user_id) id from usage_events
     where user_id is not null
     order by user_id, occurred_at desc
  ), newest_company as (
    select distinct on (company_id) id from usage_events
     order by company_id, occurred_at desc
  ), gone as (
    delete from usage_events ue
     where ue.occurred_at < now() - case when ue.module = 'flow' then interval '365 days' else interval '90 days' end
       and ue.id not in (select id from newest_user)
       and ue.id not in (select id from newest_company)
    returning 1
  )
  select count(*)::int into v_count from gone;
  return v_count;
end;
$$;
revoke all on function prune_usage_events() from public, anon, authenticated;
grant execute on function prune_usage_events() to service_role;
