-- A complete profile for every team member, and a reminder until it is.
--
-- The personal details a studio needs to pay someone and reach their family
-- live in their own table, member_profiles, readable only by the member and
-- the studio owner -- not in users, which every team member can read.
--
-- profile_missing() is the one rule for "complete": photo, phone, address,
-- date of birth, an emergency contact, where to send pay (UPI, or bank account
-- with IFSC), and PAN for in-house staff. The dashboard, the directory and the
-- reminder all use it.
--
-- run_profile_reminder_cron(): every morning (after 10 am India) each active
-- member with a login and a gap hears what is missing -- every day, until it
-- is done. Owners get one weekly note with how many profiles are incomplete.

create table if not exists member_profiles (
  user_id            uuid primary key references users (user_id) on delete cascade,
  company_id         uuid not null references companies (id) on delete cascade,
  date_of_birth      date,
  blood_group        text check (blood_group is null or length(blood_group) <= 5),
  joined_on          date,
  emergency_name     text,
  emergency_relation text,
  emergency_phone    text,
  upi_id             text,
  bank_account_name  text,
  bank_account_number text,
  bank_ifsc          text,
  pan                text check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  updated_at         timestamptz not null default now()
);
create index if not exists member_profiles_company_idx on member_profiles (company_id);

drop trigger if exists member_profiles_set_updated_at on member_profiles;
create trigger member_profiles_set_updated_at
  before update on member_profiles
  for each row execute function set_updated_at();

alter table member_profiles enable row level security;
drop policy if exists member_profiles_select on member_profiles;
drop policy if exists member_profiles_write on member_profiles;
create policy member_profiles_select on member_profiles
  for select to authenticated
  using (company_id = get_current_company_id() and (user_id = auth.uid() or is_current_owner()));
create policy member_profiles_write on member_profiles
  for all to authenticated
  using (company_id = get_current_company_id() and (user_id = auth.uid() or is_current_owner()))
  with check (company_id = get_current_company_id() and (user_id = auth.uid() or is_current_owner()));

-- What is still missing from someone's profile, in the order the form asks.
create or replace function profile_missing(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select array_remove(array[
    case when nullif(btrim(u.avatar_url), '') is null then 'photo' end,
    case when nullif(btrim(u.phone), '') is null then 'phone' end,
    case when nullif(btrim(u.address), '') is null then 'address' end,
    case when mp.date_of_birth is null then 'date_of_birth' end,
    case when nullif(btrim(mp.emergency_name), '') is null or nullif(btrim(mp.emergency_phone), '') is null
         then 'emergency_contact' end,
    case when nullif(btrim(mp.upi_id), '') is null
          and (nullif(btrim(mp.bank_account_number), '') is null or nullif(btrim(mp.bank_ifsc), '') is null)
         then 'payout' end,
    case when coalesce(u.engagement_type, 'in_house') = 'in_house' and mp.pan is null then 'pan' end
  ], null)
    from users u
    left join member_profiles mp on mp.user_id = u.user_id
   where u.user_id = p_user
$$;
revoke all on function profile_missing(uuid) from public, anon;
grant execute on function profile_missing(uuid) to authenticated, service_role;

-- How many things a profile asks for (PAN only for in-house staff).
create or replace function profile_required_count(p_user uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case when coalesce(engagement_type, 'in_house') = 'in_house' then 7 else 6 end
    from users where user_id = p_user
$$;
revoke all on function profile_required_count(uuid) from public, anon;
grant execute on function profile_required_count(uuid) to authenticated, service_role;

-- Owner: everyone's gaps at once (names of fields only -- no values).
create or replace function team_profile_gaps()
returns table (user_id uuid, missing text[], required int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_current_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select u.user_id, profile_missing(u.user_id), profile_required_count(u.user_id)
      from users u
     where u.company_id = get_current_company_id()
       and u.deleted_at is null
       and coalesce(u.status, 'active') = 'active'
       and u.role <> 'super_admin';
end;
$$;
revoke all on function team_profile_gaps() from public, anon;
grant execute on function team_profile_gaps() to authenticated;

create or replace function run_profile_reminder_cron(p_dry_run boolean default false, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local   timestamp := p_now at time zone 'Asia/Kolkata';
  v_today   date := v_local::date;
  v_week    text := to_char(v_local, 'IYYY-IW');
  v_members int := 0;
  v_created int := 0;
  v_r       record;
  v_labels  text;
  v_summary jsonb;
  v_run     uuid;
begin
  insert into cron_runs (job_name, dry_run) values ('profile_reminder_cron', p_dry_run) returning id into v_run;

  if extract(hour from v_local) >= 10 then
    for v_r in
      select u.user_id, u.company_id, m.missing, profile_required_count(u.user_id) as required
        from users u
        cross join lateral (select profile_missing(u.user_id) as missing) m
       where u.deleted_at is null
         and coalesce(u.status, 'active') = 'active'
         and coalesce(u.login_enabled, true)
         and u.role <> 'super_admin'
         and u.created_at < p_now - interval '1 day'
         and cardinality(m.missing) > 0
    loop
      v_members := v_members + 1;
      select string_agg(case x
               when 'photo' then 'photo'
               when 'phone' then 'phone number'
               when 'address' then 'address'
               when 'date_of_birth' then 'date of birth'
               when 'emergency_contact' then 'emergency contact'
               when 'payout' then 'UPI or bank details'
               when 'pan' then 'PAN'
               else x end, ', ')
        into v_labels
        from unnest(v_r.missing) x;
      if not p_dry_run then
        if create_notification(
             v_r.company_id, v_r.user_id, 'profile_incomplete',
             'Complete your profile (' ||
               round(100.0 * (v_r.required - cardinality(v_r.missing)) / greatest(v_r.required, 1)) || '% done)',
             'Still needed: ' || v_labels,
             'profile_incomplete:' || v_r.user_id || ':' || v_today,
             'user', v_r.user_id, 'warning', '/profile',
             jsonb_build_object('missing', v_r.missing)) then
          v_created := v_created + 1;
        end if;
      end if;
    end loop;

    -- The owner hears once a week how many are still incomplete.
    for v_r in
      select u.company_id, count(*) as n
        from users u
       where u.deleted_at is null and coalesce(u.status, 'active') = 'active'
         and u.role <> 'super_admin'
         and cardinality(profile_missing(u.user_id)) > 0
       group by u.company_id
    loop
      if not p_dry_run then
        if create_notification(
             v_r.company_id, (select owner_user_id from companies where id = v_r.company_id), 'profile_digest',
             v_r.n || case when v_r.n = 1 then ' team profile is' else ' team profiles are' end || ' incomplete',
             'They are reminded every day. See who in the Team Directory.',
             'profile_digest:' || v_r.company_id || ':' || v_week,
             'user', null, 'info', '/employees?profile=incomplete') then
          v_created := v_created + 1;
        end if;
      end if;
    end loop;
  end if;

  v_summary := jsonb_build_object('members', v_members, 'notifications_created', v_created, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;
revoke all on function run_profile_reminder_cron(boolean, timestamptz) from public, anon;
grant execute on function run_profile_reminder_cron(boolean, timestamptz) to service_role;

grant select, insert, update on member_profiles to authenticated;
