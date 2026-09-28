-- 0210: a 30-day free trial for every studio, and the 2-year plan at
-- Rs 33,000 + GST.
--
-- Until now a new studio was given grandfathered_until = now() + 10 years
-- (0018), so nobody's access ever ran out and "Free trial" on the
-- Subscription page meant "free forever". The owner's decision: every studio
-- that is not paying gets 30 days, sees how many are left, and then picks a
-- plan. That applies to studios already on the app too, counted from today.
--
-- Never affected:
--   * a studio with a paid plan still running (plan_expiry in the future);
--   * a studio owned by a platform admin -- the owner's own studio;
--   * a studio already inside a shorter window (a trial or a grace period
--     someone set by hand ends when it ends).
-- Anyone can be extended from the platform Studios page as before
-- (platform_extend_plan, platform_grant_trial).

-- ── the 30 days ───────────────────────────────────────────────
alter table companies alter column grandfathered_until set default (now() + interval '30 days');

update companies c
   set grandfathered_until = now() + interval '30 days'
 where c.grandfathered_until > now() + interval '30 days'
   and coalesce(c.plan_expiry, 'epoch'::timestamptz) <= now()
   and not exists (select 1 from platform_admins pa where pa.user_id = c.owner_user_id);

-- ── the 2-year plan ───────────────────────────────────────────
-- 24 months of monthly is Rs 47,976, so this saves Rs 14,976; per month it
-- is Rs 1,375. Checkout adds 18% GST as for every plan.
update plans
   set price = 33000,
       monthly_equivalent = 1375,
       savings_label = 'Save ₹14,976 vs 24 months of monthly',
       updated_at = now()
 where key = 'ipc_2year';

-- The one rule for "access ends on", used by the Studios list below and the
-- studio's own Subscription page: the paid plan if it is running, else the
-- trial, else the grace period; once all have passed, the latest of them.
create or replace function company_access_until(p_plan timestamptz, p_trial timestamptz, p_grace timestamptz)
returns timestamptz
language sql
stable
as $$
  select case
    when coalesce(p_plan,  'epoch'::timestamptz) > now() then p_plan
    when coalesce(p_trial, 'epoch'::timestamptz) > now() then p_trial
    when coalesce(p_grace, 'epoch'::timestamptz) > now() then p_grace
    else greatest(p_plan, p_trial, p_grace)
  end
$$;

-- ── when access ends, for the platform's Studios list ─────────
-- The list showed Expiry as plan_expiry only, which is null on a trial, so
-- the owner could not see when a studio's 30 days ran out. access_until is
-- the date the studio's current access ends, whichever gate is holding it
-- open. Copied from 0019 with that one column added; the return type
-- changes, so the old function is dropped first.
drop function if exists platform_list_studios();
create or replace function platform_list_studios()
returns table (
  id            uuid,
  name          text,
  owner_email   text,
  plan_gate     text,
  plan_expiry   timestamptz,
  user_count    bigint,
  project_count bigint,
  created_at    timestamptz,
  access_until  timestamptz
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
      company_access_until(c.plan_expiry, c.grandfathered_until, c.grace_until)
    from companies c
    left join users owner on owner.user_id = c.owner_user_id
    order by c.created_at desc;
end;
$$;
revoke all on function platform_list_studios() from public, anon;
grant execute on function platform_list_studios() to authenticated;

-- ── plan names, after the rename to Studio AutoPilot ──────────
-- "IPC Monthly" read as a brand the studio has never heard of.
update plans set name = 'Monthly', updated_at = now() where key = 'ipc_monthly' and name = 'IPC Monthly';
update plans set name = 'Yearly',  updated_at = now() where key = 'ipc_yearly'  and name = 'IPC Yearly';
update plans set name = '2-Year',  updated_at = now() where key = 'ipc_2year'   and name = 'IPC 2-Year';
