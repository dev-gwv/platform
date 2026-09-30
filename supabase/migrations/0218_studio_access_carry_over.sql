-- 0218: Studio Access carries the old app's subscribers over.
--
-- The owner ran every studio's access from the old app's Studio Access board:
-- 776 studios, who is active, who expires this week. None of those studios
-- are in this system -- the old database was never imported -- and the owner's
-- own login was never made a platform admin here, so the board was not even
-- visible. This migration fixes both:
--
--   * the owner's account is a platform admin (the list has no screen; 0019);
--   * legacy_studios holds the old app's Studio Access export, imported from
--     the board. When a studio's owner (or an admin) signs up here with the
--     same email, the paid time left from the old app carries over to the new
--     studio's plan_expiry -- never shortening what it already has.
--
-- Service-only: rows carry outsiders' emails and phones. The platform admin
-- reads them through platform_legacy_studios(), gated like platform_list_studios().

insert into platform_admins (user_id)
select id from auth.users where lower(email) = 'connect@wpbmastery.in'
on conflict do nothing;

create table if not exists legacy_studios (
  id                 uuid primary key default gen_random_uuid(),
  old_company_id     text not null unique,        -- the old app's Company ID: re-import updates, never doubles
  studio_name        text not null,
  owner_name         text,
  email              text,                        -- lower-cased on the way in
  phone              text,
  plan               text,
  expires_at         date,
  old_created_at     date,
  imported_at        timestamptz not null default now(),
  joined_company_id  uuid references companies (id) on delete set null,
  carried_at         timestamptz
);
create index if not exists legacy_studios_email_idx on legacy_studios (email) where joined_company_id is null;

alter table legacy_studios enable row level security;
revoke all on legacy_studios from public, anon, authenticated;
grant select, insert, update, delete on legacy_studios to service_role;

-- A studio found on the new app takes the old app's paid time: plan_expiry
-- moves to the end of the old expiry day when that is later than what it has.
-- An expired old row carries nothing but is still marked joined.
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
  with matched as (
    select l.id, l.expires_at
      from legacy_studios l
     where l.joined_company_id is null
       and l.email is not null
       and l.email in (
         select lower(u.email) from users u
          where u.company_id = p_company
            and u.deleted_at is null
            and (u.role in ('super_admin', 'admin') or u.user_id = (select owner_user_id from companies where id = p_company))
       )
  ), marked as (
    update legacy_studios l
       set joined_company_id = p_company, carried_at = now()
      from matched m
     where l.id = m.id
    returning m.expires_at
  )
  select count(*)::int, max((expires_at + 1)::timestamptz) filter (where expires_at >= current_date)
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

-- Every new person in a studio is checked: the owner signing up, or an admin
-- joining later with the email the old app knew.
create or replace function users_legacy_carry_over()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from legacy_studios where joined_company_id is null and email = lower(new.email)) then
    perform legacy_carry_over(new.company_id);
  end if;
  return null;
end;
$$;
drop trigger if exists users_legacy_carry_over on users;
create trigger users_legacy_carry_over after insert on users
  for each row execute function users_legacy_carry_over();

-- The board's list: every imported row, joined or not.
create or replace function platform_legacy_studios()
returns table (
  id                 uuid,
  old_company_id     text,
  studio_name        text,
  owner_name         text,
  email              text,
  phone              text,
  plan               text,
  expires_at         text,
  old_created_at     text,
  joined_company_id  uuid,
  joined_name        text,
  carried_at         timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  return query
    select l.id, l.old_company_id, l.studio_name, l.owner_name, l.email, l.phone, l.plan,
           l.expires_at::text, l.old_created_at::text, l.joined_company_id, c.name, l.carried_at
      from legacy_studios l
      left join companies c on c.id = l.joined_company_id
     order by l.old_created_at desc nulls last, l.studio_name;
end;
$$;
revoke all on function platform_legacy_studios() from public, anon;
grant execute on function platform_legacy_studios() to authenticated;
