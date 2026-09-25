-- ID proof on file, and a check-out that works after midnight.
--
-- member_documents: a member's ID proof (Aadhaar, PAN card, passport...) kept
-- in its own table, NOT in `files` -- every file there can be read by anyone
-- in the studio who has its id. These rows are readable only by the member and
-- the studio owner, like member_profiles. For in-house staff one document on
-- file is part of a complete profile.
--
-- check_out(): a wedding that runs past midnight used to leave the shift open
-- for ever -- the tap at 1 am looked for a row dated today and found none. It
-- now closes the latest open shift that started in the last 20 hours; one left
-- open longer than that is a forgotten check-out for a manager to fix.

create table if not exists member_documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  user_id     uuid not null references users (user_id) on delete cascade,
  kind        text not null default 'other'
              check (kind in ('aadhaar', 'pan_card', 'passport', 'driving_licence', 'voter_id', 'other')),
  name        text not null check (length(name) between 1 and 200),
  mime        text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes  int  not null check (size_bytes > 0 and size_bytes <= 5 * 1024 * 1024),
  bytes       bytea not null,
  uploaded_by uuid references users (user_id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists member_documents_user_idx on member_documents (user_id, created_at desc);

alter table member_documents enable row level security;
drop policy if exists member_documents_select on member_documents;
drop policy if exists member_documents_insert on member_documents;
drop policy if exists member_documents_delete on member_documents;
create policy member_documents_select on member_documents
  for select to authenticated
  using (company_id = get_current_company_id() and (user_id = auth.uid() or is_current_owner()));
create policy member_documents_insert on member_documents
  for insert to authenticated
  with check (company_id = get_current_company_id() and is_current_user_active()
              and (user_id = auth.uid() or is_current_owner()));
create policy member_documents_delete on member_documents
  for delete to authenticated
  using (company_id = get_current_company_id() and (user_id = auth.uid() or is_current_owner()));
grant select, insert, delete on member_documents to authenticated;

-- The one rule for "complete" (0175), now with ID proof for in-house staff.
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
    case when coalesce(u.engagement_type, 'in_house') = 'in_house' and mp.pan is null then 'pan' end,
    case when coalesce(u.engagement_type, 'in_house') = 'in_house'
          and not exists (select 1 from member_documents d where d.user_id = u.user_id)
         then 'id_document' end
  ], null)
    from users u
    left join member_profiles mp on mp.user_id = u.user_id
   where u.user_id = p_user
$$;

create or replace function profile_required_count(p_user uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case when coalesce(engagement_type, 'in_house') = 'in_house' then 8 else 6 end
    from users where user_id = p_user
$$;

-- The daily reminder names ID proof in words, like the rest.
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
               when 'id_document' then 'ID proof'
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

-- A check-out closes the latest open shift, even one that began yesterday.
create or replace function check_out()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id      uuid;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update attendance
     set check_out_at = now()
   where id = (
           select a.id
             from attendance a
            where a.company_id = v_company
              and a.user_id = auth.uid()
              and a.check_in_at is not null
              -- Only an OPEN shift can be closed: a second tap must not move
              -- the first check-out and change the hours worked.
              and a.check_out_at is null
              and a.check_in_at > now() - interval '20 hours'
            order by a.check_in_at desc
            limit 1
            for update)
  returning id into v_id;

  if v_id is null then
    raise exception 'no_open_check_in: nothing to check out of'
      using errcode = 'P0001';
  end if;

  return v_id;
end;
$$;
revoke all on function check_out() from public, anon;
grant execute on function check_out() to authenticated;
