-- 0256: the plans go live (owner, 10 Oct 2026, after seeing the preview).
--
--   * Starter, Pro and Studio Max (0241, 0242) go on sale to studios outside
--     IPC, yearly and monthly.
--   * The one outsider plan, ₹1,00,000 a year (0214), comes off sale. A studio
--     already on it keeps it until it ends: nothing here touches companies.
--   * "WhatsApp & email from credits" leaves the cards: message credits are
--     not built yet, and a card must not promise what a studio cannot buy.
--   * IPC Diamond members keep their own three plans, untouched.
--
-- Buying is a conversation for now ("Talk to us on WhatsApp"); the platform
-- owner gives the plan from Studio Access Manager (platform_assign_plan, 0226).

update plans
   set is_active = true, updated_at = now()
 where key in ('starter_yearly', 'starter_monthly', 'pro_yearly', 'pro_monthly', 'max_yearly', 'max_monthly');

update plans
   set is_active = false, updated_at = now()
 where key = 'studio_yearly';

update plans
   set features = case key
         when 'starter_yearly' then jsonb_build_array('30 projects a year', '3 team logins · 20 crew', 'Every feature included')
         else jsonb_build_array('3 projects a month', '3 team logins · 20 crew', 'Every feature included')
       end,
       updated_at = now()
 where key in ('starter_yearly', 'starter_monthly');

update plans
   set features = jsonb_build_array('Unlimited projects, leads and team', 'Every feature, no limits'),
       updated_at = now()
 where key in ('pro_yearly', 'pro_monthly');

-- ── Platform → Plans ─────────────────────────────────────────────────
-- The owner's view of the catalogue: every plan, who it is for, its limits,
-- how many studios are on it now, and a switch to put it on sale or take it
-- off. Copied from 0226 (the only definition) with tier, limits, sort_order
-- and studios added; the return type changes, so the old one is dropped.
drop function if exists platform_plans();
create or replace function platform_plans()
returns table (id uuid, key text, name text, price numeric, billing_interval text,
               duration_days int, audience text, is_active boolean,
               tier text, limits jsonb, sort_order int, studios int)
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
    select p.id, p.key, p.name, p.price, p.billing_interval, p.duration_days, p.audience, p.is_active,
           p.tier, coalesce(p.limits, '{}'::jsonb), p.sort_order,
           (select count(*)::int from companies c where c.plan = p.key and c.plan_expiry > now())
      from plans p
     order by p.is_active desc, p.audience desc, p.sort_order, p.price;
end;
$$;
revoke all on function platform_plans() from public, anon;
grant execute on function platform_plans() to authenticated;

-- Paying studios and studios still on their free trial, for the page's one line.
create or replace function platform_plan_counts()
returns table (paying int, on_trial int)
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
    select count(*) filter (where c.plan_expiry > now())::int,
           count(*) filter (where coalesce(c.plan_expiry, 'epoch'::timestamptz) <= now()
                              and c.grandfathered_until > now())::int
      from companies c;
end;
$$;
revoke all on function platform_plan_counts() from public, anon;
grant execute on function platform_plan_counts() to authenticated;

-- On sale or off. Taking a plan off never touches a studio already on it.
create or replace function platform_set_plan_on_sale(p_key text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  update plans set is_active = p_on, updated_at = now() where key = p_key;
  if not found then
    raise exception 'unknown plan' using errcode = '22023';
  end if;
end;
$$;
revoke all on function platform_set_plan_on_sale(text, boolean) from public, anon;
grant execute on function platform_set_plan_on_sale(text, boolean) to authenticated;
