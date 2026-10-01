-- 0226: step 2 of the owner's next phase.
--   * platform_assign_plan(): give a studio a plan from the catalogue
--     (companies.plan + plan_expiry from plans.duration_days, a subscription
--     row and a billing event). The old "assign" set a column that does not
--     exist and swallowed the error.
--   * expense_tax_rates: a studio's own tax names and rates for expenses.
--   * Razorpay recovery: payments Razorpay captured that never credited a plan.

-- ── 1. Give a studio a plan from the catalogue ─────────────────────
-- The platform console's "assign" extended access by 12 months and then
-- wrote companies.plan_key, a column that does not exist, inside a catch that
-- hid the failure. This sets the real column and the end date from the
-- plan's own length, the same way a paid order does (activate_subscription,
-- 0131): from the later of now and the current end, so no paid days are lost.
create or replace function platform_plans()
returns table (id uuid, key text, name text, price numeric, billing_interval text,
               duration_days int, audience text, is_active boolean)
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
    select p.id, p.key, p.name, p.price, p.billing_interval, p.duration_days, p.audience, p.is_active
      from plans p
     order by p.is_active desc, p.audience, p.price;
end;
$$;
revoke all on function platform_plans() from public, anon;
grant execute on function platform_plans() to authenticated;

create or replace function platform_assign_plan(p_company_id uuid, p_plan_key text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    plans;
  v_base    timestamptz;
  v_expires timestamptz;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  select * into v_plan from plans where key = p_plan_key;
  if not found then
    raise exception 'unknown plan' using errcode = '22023';
  end if;
  select greatest(now(), coalesce(plan_expiry, now())) into v_base
    from companies where id = p_company_id for update;
  if not found then
    raise exception 'unknown studio' using errcode = '42501';
  end if;
  v_expires := case
                 when v_plan.duration_days is not null then v_base + make_interval(days => v_plan.duration_days)
                 when v_plan.billing_interval = 'yearly' then v_base + interval '12 months'
                 else v_base + interval '1 month'
               end;
  update companies set plan = v_plan.key, plan_expiry = v_expires where id = p_company_id;
  insert into company_subscriptions (company_id, plan_id, expires_at)
    values (p_company_id, v_plan.id, v_expires);
  insert into billing_events (company_id, kind, detail)
    values (p_company_id, 'platform_plan_assigned',
            jsonb_build_object('plan', v_plan.key, 'by', auth.uid(), 'new_expiry', v_expires));
  return v_expires;
end;
$$;
revoke all on function platform_assign_plan(uuid, text) from public, anon;
grant execute on function platform_assign_plan(uuid, text) to authenticated;

-- ── 2. A studio's own tax rates for expenses ──────────────────────
-- The expense form offered only the GST slabs. A studio buying gold-plated
-- album covers pays 3%; one with a named levy wants its name on the bill.
-- These are rates for an expense whose GST was charged: picking one sets the
-- expense's tax_name and gst_rate, and the GST summary counts it as input tax.
create table if not exists expense_tax_rates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade default get_current_company_id(),
  name        text not null check (length(btrim(name)) between 1 and 80),
  rate        numeric(5, 2) not null check (rate >= 0 and rate <= 100),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists expense_tax_rates_company_name_uidx
  on expense_tax_rates (company_id, lower(btrim(name)));
alter table expense_tax_rates enable row level security;
drop policy if exists expense_tax_rates_select on expense_tax_rates;
create policy expense_tax_rates_select on expense_tax_rates
  for select to authenticated
  using (company_id = get_current_company_id());
drop policy if exists expense_tax_rates_write on expense_tax_rates;
create policy expense_tax_rates_write on expense_tax_rates
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager())
  with check (company_id = get_current_company_id() and is_current_admin_or_manager());
grant select, insert, update, delete on expense_tax_rates to authenticated;

-- ── 3. Razorpay: money taken, plan not given ──────────────────────
-- An order stays 'created' when the browser closed before /activate and the
-- webhook never matched (or was not set up). This lists those orders, with
-- the captured payment the webhook ledger already holds for them when it has
-- one, and the captured payments whose order is not ours at all. Crediting is
-- done by the API, which asks Razorpay itself before it trusts a payment id.
create or replace function platform_payment_recovery()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_stuck jsonb; v_unmatched jsonb;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) into v_stuck
    from (
      select o.id as order_id, o.company_id, c.name as company_name, p.name as plan_name,
             o.amount, o.created_at, o.razorpay_order_id,
             (select e.payload #>> '{payload,payment,entity,id}'
                from razorpay_webhook_events e
               where e.payload #>> '{payload,payment,entity,order_id}' = o.razorpay_order_id
                 and e.payload ->> 'event' in ('payment.captured', 'order.paid')
               order by e.processed_at desc limit 1) as captured_payment_id
        from payment_orders o
        join companies c on c.id = o.company_id
        left join plans p on p.id = o.plan_id
       where o.status = 'created'
         and o.razorpay_order_id is not null
         and o.created_at > now() - interval '60 days'
         and o.created_at < now() - interval '10 minutes'
       limit 200
    ) r;
  select coalesce(jsonb_agg(u order by u.processed_at desc), '[]'::jsonb) into v_unmatched
    from (
      select e.event_id, e.processed_at,
             e.payload #>> '{payload,payment,entity,id}' as payment_id,
             e.payload #>> '{payload,payment,entity,order_id}' as razorpay_order_id,
             (e.payload #>> '{payload,payment,entity,amount}')::numeric / 100 as amount,
             e.payload #>> '{payload,payment,entity,email}' as email
        from razorpay_webhook_events e
       where e.payload ->> 'event' = 'payment.captured'
         and e.processed_at > now() - interval '60 days'
         and not exists (select 1 from payment_orders o
                          where o.razorpay_order_id = e.payload #>> '{payload,payment,entity,order_id}')
       limit 100
    ) u;
  return jsonb_build_object('stuck', v_stuck, 'unmatched', v_unmatched);
end;
$$;
revoke all on function platform_payment_recovery() from public, anon;
grant execute on function platform_payment_recovery() to authenticated;
