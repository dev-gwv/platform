-- 0245: the Studio Access Manager shows each studio's owner and phone.
--
-- platform_list_studios() (copied from 0214) gains the owner's name and
-- phone -- the owner's own profile, else the studio's invoice phone -- so the
-- vendor console reads Studio · Owner · Email · Phone as the old app did.
-- The return type changes, so the function is dropped first.

drop function if exists platform_list_studios();
create function platform_list_studios()
returns table (
  id            uuid,
  name          text,
  owner_email   text,
  plan_gate     text,
  plan_expiry   timestamptz,
  user_count    bigint,
  project_count bigint,
  created_at    timestamptz,
  access_until  timestamptz,
  member_tier   text,
  owner_name    text,
  owner_phone   text
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
    select
      c.id,
      c.name,
      owner.email,
      platform_plan_gate(c.plan_expiry, c.grandfathered_until, c.grace_until),
      c.plan_expiry,
      (select count(*) from users u where u.company_id = c.id and u.deleted_at is null),
      (select count(*) from projects p where p.company_id = c.id),
      c.created_at,
      company_access_until(c.plan_expiry, c.grandfathered_until, c.grace_until),
      c.member_tier,
      nullif(btrim(owner.name), ''),
      coalesce(nullif(btrim(owner.phone), ''), nullif(btrim(c.invoice_phone), ''))
    from companies c
    left join users owner on owner.user_id = c.owner_user_id
    order by c.created_at desc;
end;
$$;
revoke all on function platform_list_studios() from public, anon;
grant execute on function platform_list_studios() to authenticated;
