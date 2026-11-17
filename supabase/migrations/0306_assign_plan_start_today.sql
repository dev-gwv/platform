-- 0306: a plan given by hand can start today (owner, 17 Nov).
--
-- Studio Access Manager's Give plan always added the new plan's length on top
-- of the current end date. For an upgrade bought at the difference (plan_quote,
-- 0242: what is left of the old plan comes off the price, the new plan year
-- starts today) that gave the studio its unused days twice, and the owner had
-- to fix the end date by hand with Custom expiry. With p_start_today the plan
-- runs from today and its plan year starts today; without it nothing changes.
--
-- Copied from 0242 (the latest definition). The argument list changes, so the
-- old one is dropped first. Safe to run twice.

drop function if exists platform_assign_plan(uuid, text);

create or replace function platform_assign_plan(p_company_id uuid, p_plan_key text, p_start_today boolean default false)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    plans;
  v_base    timestamptz;
  v_expires timestamptz;
  v_old     companies;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  select * into v_plan from plans where key = p_plan_key;
  if not found then
    raise exception 'unknown plan' using errcode = '22023';
  end if;
  select * into v_old from companies where id = p_company_id for update;
  if not found then
    raise exception 'unknown studio' using errcode = '42501';
  end if;
  v_base := case when p_start_today then now() else greatest(now(), coalesce(v_old.plan_expiry, now())) end;
  v_expires := case
                 when v_plan.duration_days is not null then v_base + make_interval(days => v_plan.duration_days)
                 when v_plan.billing_interval = 'yearly' then v_base + interval '12 months'
                 else v_base + interval '1 month'
               end;
  update companies
     set plan = v_plan.key,
         plan_expiry = v_expires,
         plan_period_start = case
           when p_start_today
             or v_old.plan is distinct from v_plan.key
             or v_old.plan_expiry is null or v_old.plan_expiry <= now()
             or v_old.plan_period_start is null then now()
           else v_old.plan_period_start
         end
   where id = p_company_id;
  insert into company_subscriptions (company_id, plan_id, expires_at)
    values (p_company_id, v_plan.id, v_expires);
  insert into billing_events (company_id, kind, detail)
    values (p_company_id, 'platform_plan_assigned',
            jsonb_build_object('plan', v_plan.key, 'by', auth.uid(), 'new_expiry', v_expires, 'start_today', p_start_today));
  return v_expires;
end;
$$;
revoke all on function platform_assign_plan(uuid, text, boolean) from public, anon;
grant execute on function platform_assign_plan(uuid, text, boolean) to authenticated;
