-- 0267: Starter counts by the year, never by the month (owner, 17 Oct).
--
-- "They should be able to do at least 30 projects per year. You cannot bar
-- that by month ... if they want to do all the projects in 1 month, they
-- should be able to add the project." So:
--
--   * Every Starter row -- Diamond and regular, yearly and monthly -- carries
--     the same numbers: 30 projects and 30 GST invoices a plan year, 3 team
--     logins and 10 crew (team without a login). The rest is as 0242 set it.
--     A monthly plan no longer gets a twelfth (3 projects, 5 invoices).
--   * plan_window() always spans a plan year from the day the studio first
--     paid (companies.plan_period_start), monthly plans included: renewing a
--     month keeps the anchor (activate_subscription, 0242), so the 30 run for
--     the year and can all be used in one month.
--   * The cards say it: "30 projects a year", "30 invoices a year",
--     "3 team logins · 10 crew".
--
-- plan_window is copied from 0242 (its only definition) with the window fixed
-- at 365 days; company_usage, my_plan_usage and enforce_plan_limit read it
-- unchanged, so their words become "a year" for every plan.

update plans
   set limits = '{"projects":30,"invoices":30,"leads":300,"team_logins":3,"team_members":10,"enquiry_forms":2,"facebook_pages":1,"packages":3,"storage_mb":2048}'::jsonb,
       features = jsonb_build_array('30 projects a year', '30 invoices a year', '3 team logins · 10 crew'),
       updated_at = now()
 where key in ('starter_yearly', 'starter_monthly', 'starter_yearly_regular', 'starter_monthly_regular');

-- The plan year that holds now: the anchor plus whole years. Without an
-- anchor, the paid period counts back from its end; without a plan, the last
-- year.
create or replace function plan_window(p_company uuid)
returns table (starts timestamptz, ends timestamptz, period_days int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days   int := 365;
  v_anchor timestamptz;
  v_n      int;
begin
  select coalesce(c.plan_period_start,
                  c.plan_expiry - make_interval(days => coalesce(p.duration_days, case when p.billing_interval = 'monthly' then 30 else 365 end)))
    into v_anchor
    from companies c left join plans p on p.key = c.plan
   where c.id = p_company;
  if v_anchor is null then
    return query select now() - interval '365 days', now(), 365;
    return;
  end if;
  v_n := greatest(0, floor(extract(epoch from (now() - v_anchor)) / (v_days * 86400.0))::int);
  return query select v_anchor + make_interval(days => v_n * v_days),
                      v_anchor + make_interval(days => (v_n + 1) * v_days),
                      v_days;
end;
$$;
revoke all on function plan_window(uuid) from public, anon;
grant execute on function plan_window(uuid) to authenticated, service_role;
