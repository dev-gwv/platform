-- 0241: plans with limits and what they include.
--
-- A plan says how many projects and invoices a month, how many team logins
-- and enquiry forms it allows (null = unlimited), and which extras it carries
-- (white-label, the studio's own WhatsApp, sequences that send by themselves).
-- The database checks the limits as a row is made; nothing already there is
-- touched. Paying for a plan now records which plan the studio is on.
--
-- A free trial has no limits (a new studio sees the whole app), and a plan
-- with no limits written ('{}', every plan before this one) is unlimited, so
-- nobody already paying is touched. Leads are never limited: they are the
-- studio's customers arriving.

alter table plans
  add column if not exists tier text check (tier is null or tier in ('starter', 'pro', 'max')),
  -- projects_per_month, invoices_per_month, team_logins, enquiry_forms; a
  -- missing key is unlimited.
  add column if not exists limits jsonb not null default '{}'::jsonb,
  -- Extras the plan carries: any of 'white_label', 'whatsapp_api', 'sequences_auto'.
  add column if not exists includes text[] not null default '{}';

-- ── the plan a studio is on, and its limits ──────────────────────────
-- The limits of the plan the studio has paid for and is still inside; none
-- while it is on a trial or on a plan with no limits written.
create or replace function company_plan(p_company uuid)
returns plans
language sql
stable
security definer
set search_path = public
as $$
  select p.* from companies c join plans p on p.key = c.plan
   where c.id = p_company and c.plan_expiry is not null and c.plan_expiry > now()
$$;
revoke all on function company_plan(uuid) from public, anon;
grant execute on function company_plan(uuid) to authenticated, service_role;

-- What a studio has made this month (India), and has now.
create or replace function company_usage(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with m as (select (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as starts)
  select jsonb_build_object(
    'projects_per_month', (select count(*) from projects, m where company_id = p_company and created_at >= m.starts),
    'invoices_per_month', (select count(*) from invoices, m where company_id = p_company and created_at >= m.starts),
    'team_logins', (select count(*) from users u join companies c on c.id = u.company_id
                     where u.company_id = p_company and u.login_enabled and u.status <> 'inactive'
                       and u.user_id <> c.owner_user_id),
    'enquiry_forms', (select count(*) from enquiry_forms where company_id = p_company and archived_at is null)
  )
$$;
revoke all on function company_usage(uuid) from public, anon;
grant execute on function company_usage(uuid) to authenticated, service_role;

-- The studio's own plan, limits and usage, for its Subscription page.
create or replace function my_plan_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_plan    plans;
begin
  if v_company is null then
    raise exception 'no studio' using errcode = '42501';
  end if;
  v_plan := company_plan(v_company);
  return jsonb_build_object(
    'plan_key', v_plan.key,
    'plan_name', v_plan.name,
    'tier', v_plan.tier,
    'limits', coalesce(v_plan.limits, '{}'::jsonb),
    'includes', to_jsonb(coalesce(v_plan.includes, '{}')),
    'used', company_usage(v_company)
  );
end;
$$;
revoke all on function my_plan_usage() from public, anon;
grant execute on function my_plan_usage() to authenticated;

-- ── the check, as a row is made ──────────────────────────────────────
-- Raises 54000 (program_limit_exceeded) with a sentence the studio can read;
-- the API turns it into 402 with an Upgrade button.
create or replace function enforce_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key   text := tg_argv[0];
  v_limit int;
  v_used  int;
  v_plan  plans;
  v_words text;
begin
  -- A team member counts only when they can sign in, and not the owner.
  if v_key = 'team_logins' then
    if not new.login_enabled or new.status = 'inactive'
       or new.user_id = (select owner_user_id from companies where id = new.company_id) then
      return new;
    end if;
    if tg_op = 'UPDATE' and old.login_enabled and old.status <> 'inactive' then
      return new;
    end if;
  end if;

  v_plan := company_plan(new.company_id);
  v_limit := nullif(v_plan.limits ->> v_key, '')::int;
  if v_limit is null then
    return new;
  end if;
  v_used := (company_usage(new.company_id) ->> v_key)::int;
  if v_used >= v_limit then
    v_words := case v_key
      when 'projects_per_month' then format('Your %s plan makes %s projects a month.', v_plan.name, v_limit)
      when 'invoices_per_month' then format('Your %s plan makes %s invoices a month.', v_plan.name, v_limit)
      when 'team_logins' then format('Your %s plan has %s team logins.', v_plan.name, v_limit)
      when 'enquiry_forms' then format('Your %s plan has %s enquiry forms.', v_plan.name, v_limit)
    end;
    raise exception '% Upgrade to add more.', v_words using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_plan_limit on projects;
create trigger projects_plan_limit before insert on projects
  for each row execute function enforce_plan_limit('projects_per_month');
drop trigger if exists invoices_plan_limit on invoices;
create trigger invoices_plan_limit before insert on invoices
  for each row execute function enforce_plan_limit('invoices_per_month');
drop trigger if exists enquiry_forms_plan_limit on enquiry_forms;
create trigger enquiry_forms_plan_limit before insert on enquiry_forms
  for each row execute function enforce_plan_limit('enquiry_forms');
drop trigger if exists users_plan_limit on users;
create trigger users_plan_limit before insert or update of login_enabled, status on users
  for each row execute function enforce_plan_limit('team_logins');

-- ── extras come with the plan as well as the platform's switch ───────
-- Copied from 0202, now also true when the plan the studio is on includes it.
create or replace function company_can(p_company uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from company_entitlements where company_id = p_company and key = p_key and enabled)
      or p_key = any (coalesce((company_plan(p_company)).includes, '{}'))
$$;
revoke all on function company_can(uuid, text) from public, anon;
grant execute on function company_can(uuid, text) to authenticated, service_role;

create or replace function my_entitlements()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct k order by k), '{}')
    from (
      select key as k from company_entitlements where company_id = get_current_company_id() and enabled
      union
      select unnest(coalesce((company_plan(get_current_company_id())).includes, '{}'))
    ) x
$$;
revoke all on function my_entitlements() from public, anon;
grant execute on function my_entitlements() to authenticated;

-- ── paying records which plan ────────────────────────────────────────
-- Copied from 0131; now also sets companies.plan, so the sidebar and the
-- limits know the plan (before, only the end date was kept).
create or replace function activate_subscription(
  p_order_id   uuid,
  p_payment_id text
)
returns table (duplicate boolean, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   payment_orders;
  v_months  int := 1;
  v_days    int;
  v_key     text;
  v_expires timestamptz;
  v_base    timestamptz;
begin
  select * into v_order from payment_orders where id = p_order_id for update;
  if not found then
    raise exception 'unknown order' using errcode = '42501';
  end if;
  if v_order.status = 'paid' then
    select cs.expires_at into v_expires from company_subscriptions cs
      where cs.company_id = v_order.company_id order by cs.expires_at desc limit 1;
    return query select true, v_expires;
    return;
  end if;

  select case when p.billing_interval = 'yearly' then 12 else 1 end, p.duration_days, p.key
    into v_months, v_days, v_key
    from plans p where p.id = v_order.plan_id;

  -- Extend from the later of now / current expiry (no lost days).
  select greatest(now(), coalesce(plan_expiry, now())) into v_base
    from companies where id = v_order.company_id;
  -- A plan with its own duration_days wins over the monthly/yearly interval.
  v_expires := case
                 when v_days is not null then v_base + make_interval(days => v_days)
                 else v_base + make_interval(months => v_months)
               end;

  update payment_orders set status = 'paid' where id = p_order_id;
  insert into payment_transactions (order_id, company_id, razorpay_payment_id, amount)
    values (p_order_id, v_order.company_id, p_payment_id, v_order.amount);
  insert into company_subscriptions (company_id, plan_id, expires_at, order_id)
    values (v_order.company_id, v_order.plan_id, v_expires, p_order_id);
  update companies set plan_expiry = v_expires, plan = coalesce(v_key, plan) where id = v_order.company_id;
  insert into billing_events (company_id, kind, detail)
    values (v_order.company_id, 'subscription_activated', jsonb_build_object('order_id', p_order_id));

  return query select false, v_expires;
end;
$$;

-- ── the proposed plans (docs/plans.md, option A) ─────────────────────
-- Written switched off: studios see today's plans until the owner picks an
-- option, and switching them on is a one-line migration.
insert into plans (
  key, name, description, price, currency, billing_interval, duration_days,
  sort_order, badge, billing_label, savings_label, monthly_equivalent, features, is_active, audience,
  tier, limits, includes
)
values
  ('starter_yearly', 'Starter', 'For a studio doing up to 8 shoots a month.', 17988, 'INR', 'yearly', 365, 10,
   null, 'Billed yearly', 'Save ₹6,000', 1499,
   jsonb_build_array('8 projects and 25 invoices a month', '5 team logins', 'Unlimited leads'), false, 'outsider',
   'starter', '{"projects_per_month":8,"invoices_per_month":25,"team_logins":5,"enquiry_forms":3}', '{}'),
  ('starter_monthly', 'Starter', 'For a studio doing up to 8 shoots a month.', 1999, 'INR', 'monthly', 30, 11,
   null, 'Billed monthly', null, 1999,
   jsonb_build_array('8 projects and 25 invoices a month', '5 team logins', 'Unlimited leads'), false, 'outsider',
   'starter', '{"projects_per_month":8,"invoices_per_month":25,"team_logins":5,"enquiry_forms":3}', '{}'),
  ('pro_yearly', 'Pro', 'Everything, with no limits.', 29988, 'INR', 'yearly', 365, 20,
   'Most popular', 'Billed yearly', 'Save ₹6,000', 2499,
   jsonb_build_array('Unlimited projects, invoices and team', 'Unlimited enquiry forms'), false, 'outsider',
   'pro', '{}', '{}'),
  ('pro_monthly', 'Pro', 'Everything, with no limits.', 2999, 'INR', 'monthly', 30, 21,
   null, 'Billed monthly', null, 2999,
   jsonb_build_array('Unlimited projects, invoices and team', 'Unlimited enquiry forms'), false, 'outsider',
   'pro', '{}', '{}'),
  ('max_yearly', 'Studio Max', 'Your own brand and WhatsApp number.', 47988, 'INR', 'yearly', 365, 30,
   null, 'Billed yearly', 'Save ₹12,000', 3999,
   jsonb_build_array('Everything in Pro', 'Emails in your own name (white-label)', 'Your own WhatsApp number', 'Follow-ups that send themselves'),
   false, 'outsider', 'max', '{}', '{white_label,whatsapp_api,sequences_auto}'),
  ('max_monthly', 'Studio Max', 'Your own brand and WhatsApp number.', 4999, 'INR', 'monthly', 30, 31,
   null, 'Billed monthly', null, 4999,
   jsonb_build_array('Everything in Pro', 'Emails in your own name (white-label)', 'Your own WhatsApp number', 'Follow-ups that send themselves'),
   false, 'outsider', 'max', '{}', '{white_label,whatsapp_api,sequences_auto}')
on conflict (key) do nothing;
