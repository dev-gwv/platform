-- 0292: Import from Google Drive (the Gallery tab, 31 Oct) is for Pro and
-- above (owner, 31 Oct: "users that are on the diamond pro and above plan can
-- use this feature only; for the basic plan users it won't be available").
--
-- Pro and Studio Max, regular and Diamond, carry 'drive_import' in
-- plans.includes, so Compare plans reads it from the rows. A studio not on a
-- running plan (a trial, a platform admin's studio open for life, an old plan
-- with no tier) keeps it: only a running Starter plan is refused, and a
-- studio given the entitlement by hand (company_entitlements) has it on any
-- plan. Safe to run twice.
update plans
   set includes = array_append(includes, 'drive_import')
 where tier in ('pro', 'max')
   and not ('drive_import' = any (includes));

create or replace function company_drive_import(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select company_can(p_company, 'drive_import')
      or (company_plan(p_company)).tier is distinct from 'starter'
$$;
revoke all on function company_drive_import(uuid) from public, anon;
grant execute on function company_drive_import(uuid) to authenticated, service_role;
