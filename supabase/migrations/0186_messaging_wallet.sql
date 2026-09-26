-- Messaging wallet: WhatsApp (utility templates) and email, paid from a
-- prepaid studio wallet.
--
--   * The PLATFORM owns the WhatsApp Business Account, the phone number and
--     the message templates. Messages go out from the platform's number on a
--     studio's behalf.
--   * Each studio has a wallet in paise. A WhatsApp message costs Meta's price
--     plus the platform's markup (messaging_prices, per category). Emails are
--     free up to a monthly allowance, then charged from the same wallet.
--   * Money in: credit_wallet(). Today only the platform console calls it (a
--     manual recharge, fulfilling the studio's recharge request); a Razorpay
--     payment later credits through the same function with source 'razorpay'
--     and the payment id as the reference (idempotent on that pair).
--   * Money out: enqueue_message() locks the wallet row, charges, and writes
--     the ledger and the outbox row in one transaction. It refuses rather than
--     go below zero (below minus a per-studio overdraft, 0 by default), and
--     records the message as skipped_no_balance so the studio sees
--     "Recharge to send".
--   * The API's /cron/messages worker sends queued rows; a provider failure
--     refunds the charge. Meta's delivery webhook moves rows to
--     delivered/read, or failed (refunded).
--   * Events: an AFTER INSERT trigger on notifications copies the configured
--     types (start reminders, leave decided, payslip ready, shoot tomorrow)
--     to WhatsApp / email, as each studio has switched on. Off by default.
--
-- Every table is read-only to the app (RLS select only). Every write goes
-- through a security-definer function that checks who is asking.

-- ── wallets ──────────────────────────────────────────────────────
create table if not exists wallets (
  company_id        uuid primary key references companies (id) on delete cascade,
  balance_paise     bigint not null default 0,
  -- Warn the owner when the balance drops below this.
  low_balance_paise bigint not null default 10000 check (low_balance_paise between 0 and 10000000),
  -- How far below zero a send may take the wallet. 0 = never negative.
  overdraft_paise   bigint not null default 0 check (overdraft_paise between 0 and 100000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (balance_paise >= -overdraft_paise)
);

-- ── outbox (declared before the ledger, which names its rows) ────
create table if not exists message_outbox (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies (id) on delete cascade,
  channel             text not null check (channel in ('whatsapp', 'email')),
  category            text not null default 'utility'
                        check (category in ('utility', 'marketing', 'authentication', 'email')),
  to_address          text not null check (length(to_address) between 3 and 320),
  recipient_uid       uuid,
  template_key        text,
  vars                jsonb not null default '[]'::jsonb,
  subject             text,
  body                text,
  link                text,
  status              text not null default 'queued'
                        check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed',
                                          'skipped_no_balance', 'skipped_opt_out')),
  -- What the studio was charged, and what it cost the platform (for margin).
  cost_paise          bigint not null default 0 check (cost_paise >= 0),
  meta_cost_paise     bigint not null default 0 check (meta_cost_paise >= 0),
  -- An email inside the month's free allowance.
  free_allowance      boolean not null default false,
  provider_message_id text,
  error               text check (error is null or length(error) <= 500),
  entity_type         text,
  entity_id           uuid,
  dedupe_key          text,
  attempts            int not null default 0,
  claimed_at          timestamptz,
  refunded_at         timestamptz,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz
);
create unique index if not exists message_outbox_dedupe_idx
  on message_outbox (company_id, channel, dedupe_key) where dedupe_key is not null;
create index if not exists message_outbox_queue_idx on message_outbox (created_at) where status = 'queued';
create index if not exists message_outbox_company_idx on message_outbox (company_id, created_at desc);
create index if not exists message_outbox_provider_idx on message_outbox (provider_message_id) where provider_message_id is not null;

-- ── ledger (append-only) ─────────────────────────────────────────
create table if not exists wallet_ledger (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies (id) on delete cascade,
  kind                text not null check (kind in ('credit', 'debit')),
  amount_paise        bigint not null check (amount_paise > 0),
  balance_after       bigint not null,
  source              text not null
                        check (source in ('recharge_manual', 'razorpay', 'whatsapp', 'email', 'adjustment', 'refund')),
  reference           text check (reference is null or length(reference) <= 200),
  note                text check (note is null or length(note) <= 500),
  -- The message a debit paid for / a refund returned. Not a foreign key: the
  -- ledger is never rewritten, not even to null a link.
  message_id          uuid,
  recharge_request_id uuid,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  check ((kind = 'debit') = (source in ('whatsapp', 'email')) or source = 'adjustment')
);
create index if not exists wallet_ledger_company_idx on wallet_ledger (company_id, created_at desc);
-- A Razorpay payment credits once, however often its webhook is replayed.
create unique index if not exists wallet_ledger_razorpay_idx
  on wallet_ledger (reference) where source = 'razorpay';

create or replace function wallet_ledger_append_only()
returns trigger
language plpgsql
as $$
begin
  -- A studio being deleted takes its ledger with it (the company row is
  -- already gone inside the cascade). Nothing else may change history.
  if tg_op = 'DELETE' and not exists (select 1 from companies where id = old.company_id) then
    return old;
  end if;
  raise exception 'the wallet ledger cannot be changed' using errcode = '42501';
end;
$$;
drop trigger if exists wallet_ledger_append_only on wallet_ledger;
create trigger wallet_ledger_append_only
  before update or delete on wallet_ledger
  for each row execute function wallet_ledger_append_only();

-- ── recharge requests ────────────────────────────────────────────
create table if not exists wallet_recharge_requests (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,
  amount_paise bigint not null check (amount_paise between 10000 and 10000000),
  note         text check (note is null or length(note) <= 300),
  status       text not null default 'pending' check (status in ('pending', 'fulfilled', 'rejected', 'cancelled')),
  requested_by uuid,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid,
  admin_note   text check (admin_note is null or length(admin_note) <= 300),
  ledger_id    uuid
);
create index if not exists wallet_recharge_requests_idx on wallet_recharge_requests (company_id, created_at desc);
create index if not exists wallet_recharge_requests_pending_idx on wallet_recharge_requests (created_at) where status = 'pending';

-- ── platform price list ──────────────────────────────────────────
-- A price change is a new row; the latest effective row per channel+category
-- is the price. History stays for the margin report and the audit trail.
create table if not exists messaging_prices (
  id                 uuid primary key default gen_random_uuid(),
  channel            text not null check (channel in ('whatsapp', 'email')),
  category           text not null check (category in ('utility', 'marketing', 'authentication', 'email')),
  meta_cost_paise    int not null default 0 check (meta_cost_paise between 0 and 100000),
  markup_pct         numeric(6, 2) not null default 0 check (markup_pct between 0 and 1000),
  markup_fixed_paise int not null default 0 check (markup_fixed_paise between 0 and 100000),
  -- Email only: free emails per studio per calendar month.
  free_monthly       int not null default 0 check (free_monthly between 0 and 1000000),
  effective_from     timestamptz not null default now(),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  check ((channel = 'email') = (category = 'email'))
);
create index if not exists messaging_prices_idx on messaging_prices (channel, category, effective_from desc);

-- ── platform template catalogue ──────────────────────────────────
create table if not exists whatsapp_templates (
  id                 uuid primary key default gen_random_uuid(),
  -- Our key; enqueue_message names templates by it.
  key                text not null unique check (key ~ '^[a-z0-9_]{2,60}$'),
  name               text not null check (length(btrim(name)) between 1 and 80),
  -- The template's name in Meta's WhatsApp Manager.
  meta_template_name text not null check (meta_template_name ~ '^[a-z0-9_]{1,250}$'),
  language           text not null default 'en' check (language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  category           text not null default 'utility' check (category in ('utility', 'marketing', 'authentication')),
  body               text not null check (length(body) between 1 and 1024),
  -- What each {{n}} means, in order.
  variables          jsonb not null default '[]'::jsonb,
  status             text not null default 'pending' check (status in ('approved', 'pending', 'rejected', 'paused')),
  updated_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ── per-studio: which events send what ───────────────────────────
create table if not exists messaging_settings (
  company_id uuid not null references companies (id) on delete cascade,
  event      text not null check (event in ('start_reminder', 'leave_decided', 'payslip_ready', 'shoot_tomorrow')),
  whatsapp   boolean not null default false,
  email      boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (company_id, event)
);

-- ── people who replied STOP ──────────────────────────────────────
create table if not exists message_opt_outs (
  channel    text not null check (channel in ('whatsapp', 'email')),
  address    text not null,
  created_at timestamptz not null default now(),
  primary key (channel, address)
);

-- ── RLS: the owner reads their studio's rows; platform admins read all ──
alter table wallets                  enable row level security;
alter table wallet_ledger            enable row level security;
alter table wallet_recharge_requests enable row level security;
alter table message_outbox           enable row level security;
alter table messaging_settings       enable row level security;
alter table messaging_prices         enable row level security;
alter table whatsapp_templates       enable row level security;
alter table message_opt_outs         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['wallets', 'wallet_ledger', 'wallet_recharge_requests', 'message_outbox', 'messaging_settings'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format(
      'create policy %I on %I for select to authenticated using ((company_id = get_current_company_id() and is_current_owner()) or is_platform_admin())',
      t || '_select', t);
  end loop;
  foreach t in array array['messaging_prices', 'whatsapp_templates', 'message_opt_outs'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select to authenticated using (is_platform_admin())', t || '_select', t);
  end loop;
  foreach t in array array['wallets', 'wallet_ledger', 'wallet_recharge_requests', 'message_outbox',
                           'messaging_settings', 'messaging_prices', 'whatsapp_templates', 'message_opt_outs'] loop
    execute format('grant select on %I to authenticated', t);
    -- Belt and braces: no write policy exists, and no write grant either.
    execute format('revoke insert, update, delete, truncate on %I from authenticated, anon', t);
  end loop;
end $$;
revoke update, delete, truncate on wallet_ledger from service_role;

-- ── seeds ────────────────────────────────────────────────────────
-- Meta's India rates (INR per message, rounded up to whole paise): utility and
-- authentication about ₹0.115, marketing about ₹0.78. The platform admin edits
-- these in the console as Meta changes them.
insert into messaging_prices (channel, category, meta_cost_paise, markup_pct, markup_fixed_paise, free_monthly)
select * from (values
  ('whatsapp', 'utility',        12, 25.00, 5, 0),
  ('whatsapp', 'authentication', 12, 25.00, 5, 0),
  ('whatsapp', 'marketing',      79, 25.00, 5, 0),
  ('email',    'email',           0,  0.00, 20, 500)
) v(channel, category, meta_cost_paise, markup_pct, markup_fixed_paise, free_monthly)
where not exists (select 1 from messaging_prices);

-- Utility templates, one per event. Pending until Meta approves each one; the
-- platform admin marks them approved in the console. Every event passes the
-- same four values: {{1}} the person's first name, {{2}} the studio, {{3}}
-- the headline, {{4}} the detail.
insert into whatsapp_templates (key, name, meta_template_name, category, body, variables)
values
  ('start_reminder', 'Work start reminder', 'ipc_work_start_reminder', 'utility',
   'Hi {{1}}, a work reminder from {{2}}: {{3}}. Details: {{4}}. Open the IPC Studios app to see your work.',
   '["First name", "Studio name", "What to start", "Project and due date"]'),
  ('leave_decided', 'Leave decision', 'ipc_leave_decision', 'utility',
   'Hi {{1}}, {{2}} has replied to your leave request: {{3}}. Dates: {{4}}.',
   '["First name", "Studio name", "Approved or not", "Dates and note"]'),
  ('payslip_ready', 'Payslip ready', 'ipc_payslip_ready', 'utility',
   'Hi {{1}}, {{2}} has shared your payslip: {{3}}. {{4}}. Open the IPC Studios app to view it.',
   '["First name", "Studio name", "Payslip month", "Amount or note"]'),
  ('shoot_tomorrow', 'Shoot tomorrow', 'ipc_shoot_tomorrow', 'utility',
   'Hi {{1}}, a shoot reminder from {{2}}: {{3}}. Time and place: {{4}}. Please reach on time.',
   '["First name", "Studio name", "Shoot name", "Time, role and place"]'),
  ('test_message', 'Test message', 'ipc_test_message', 'utility',
   'Hi {{1}}, this is a test message from {{2}} on IPC Studios. Your WhatsApp messages are working.',
   '["First name", "Studio name"]')
on conflict (key) do nothing;

-- ── helpers (internal: no grants) ────────────────────────────────

-- Which studio event a notification type belongs to (null = not sent out).
create or replace function messaging_event_for_type(p_type text)
returns text
language sql
immutable
as $$
  select case p_type
    when 'deliverable_start' then 'start_reminder'
    when 'task_start'        then 'start_reminder'
    when 'leave.decided'     then 'leave_decided'
    when 'payslip_ready'     then 'payslip_ready'
    when 'payroll.payslip'   then 'payslip_ready'  -- what payroll (0185) sends
    when 'shoot_tomorrow'    then 'shoot_tomorrow'
  end
$$;

-- Price per message: cost + percentage markup (rounded UP to a paisa) +
-- fixed markup. Mirrors messagePricePaise() in packages/domain.
create or replace function messaging_price_paise(p_cost int, p_pct numeric, p_fixed int)
returns bigint
language sql
immutable
as $$
  select greatest(p_cost, 0)::bigint
       + ceil(greatest(p_cost, 0) * greatest(p_pct, 0) / 100.0)::bigint
       + greatest(p_fixed, 0)::bigint
$$;

create or replace function messaging_price_now(p_channel text, p_category text)
returns messaging_prices
language sql
stable
security definer
set search_path = public
as $$
  select * from messaging_prices
   where channel = p_channel and category = p_category and effective_from <= now()
   order by effective_from desc, created_at desc
   limit 1
$$;
revoke all on function messaging_price_now(text, text) from public, anon, authenticated;

create or replace function wallet_ensure(p_company uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into wallets (company_id) values (p_company) on conflict (company_id) do nothing
$$;
revoke all on function wallet_ensure(uuid) from public, anon, authenticated;

-- The first day of this month in India, as a timestamp.
create or replace function messaging_month_start()
returns timestamptz
language sql
stable
as $$
  select (date_trunc('month', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata'
$$;

-- Tell the owner when a debit takes the balance under their alert level.
create or replace function wallet_warn_low(p_company uuid, p_before bigint, p_after bigint, p_low bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_owner uuid;
begin
  if p_after >= p_low or p_before < p_low then
    return;
  end if;
  select owner_user_id into v_owner from companies where id = p_company;
  if v_owner is null then return; end if;
  perform create_notification(
    p_company, v_owner, 'wallet.low', 'Messaging balance is low',
    'Balance is ₹' || to_char(p_after / 100.0, 'FM999999990.00') || '. Recharge so WhatsApp messages keep going out.',
    'wallet_low:' || (now() at time zone 'Asia/Kolkata')::date, 'wallet', null, 'warning', '/settings/messaging');
end;
$$;
revoke all on function wallet_warn_low(uuid, bigint, bigint, bigint) from public, anon, authenticated;

-- Give back what a message was charged. Once per message.
create or replace function wallet_refund_message(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m   message_outbox;
  v_bal bigint;
begin
  select * into v_m from message_outbox where id = p_id for update;
  if not found or v_m.cost_paise <= 0 or v_m.refunded_at is not null then
    return;
  end if;
  update wallets set balance_paise = balance_paise + v_m.cost_paise, updated_at = now()
   where company_id = v_m.company_id
   returning balance_paise into v_bal;
  insert into wallet_ledger (company_id, kind, amount_paise, balance_after, source, reference, note, message_id)
    values (v_m.company_id, 'credit', v_m.cost_paise, v_bal, 'refund', v_m.provider_message_id,
            left(coalesce(p_reason, 'Message not sent'), 500), v_m.id);
  update message_outbox set refunded_at = now() where id = p_id;
end;
$$;
revoke all on function wallet_refund_message(uuid, text) from public, anon, authenticated;

-- ── credit: the one way money comes in ───────────────────────────
-- source: recharge_manual (platform console), razorpay (later: the payment
-- webhook, reference = payment id; replays return the first ledger row),
-- adjustment, refund. p_request fulfils that studio's pending request.
create or replace function credit_wallet(
  p_company   uuid,
  p_amount    bigint,
  p_source    text,
  p_reference text,
  p_note      text default null,
  p_request   uuid default null,
  p_by        uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bal bigint;
  v_id  uuid;
begin
  if p_source not in ('recharge_manual', 'razorpay', 'adjustment', 'refund') then
    raise exception 'not a credit source' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    raise exception 'the amount must be between ₹0.01 and ₹1,00,000' using errcode = '22023';
  end if;
  if not exists (select 1 from companies where id = p_company) then
    raise exception 'studio not found' using errcode = 'P0002';
  end if;
  if p_source = 'razorpay' then
    if nullif(btrim(p_reference), '') is null then
      raise exception 'a razorpay credit needs the payment id' using errcode = '22023';
    end if;
    select id into v_id from wallet_ledger where source = 'razorpay' and reference = p_reference;
    if found then return v_id; end if;
  end if;

  perform wallet_ensure(p_company);
  update wallets set balance_paise = balance_paise + p_amount, updated_at = now()
   where company_id = p_company
   returning balance_paise into v_bal;
  insert into wallet_ledger (company_id, kind, amount_paise, balance_after, source, reference, note, recharge_request_id, created_by)
    values (p_company, 'credit', p_amount, v_bal, p_source, nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), p_request, p_by)
    returning id into v_id;

  if p_request is not null then
    update wallet_recharge_requests
       set status = 'fulfilled', decided_at = now(), decided_by = p_by, ledger_id = v_id,
           admin_note = coalesce(nullif(btrim(p_note), ''), admin_note)
     where id = p_request and company_id = p_company and status = 'pending';
    if not found then
      raise exception 'that recharge request is not pending for this studio' using errcode = '22023';
    end if;
  end if;

  perform create_notification(
    p_company, c.owner_user_id, 'wallet.credited', 'Messaging wallet recharged',
    '₹' || to_char(p_amount / 100.0, 'FM999999990.00') || ' added. Balance ₹' || to_char(v_bal / 100.0, 'FM999999990.00') || '.',
    'wallet_credit:' || v_id, 'wallet', null, 'info', '/settings/messaging')
  from companies c where c.id = p_company and c.owner_user_id is not null;
  return v_id;
end;
$$;
revoke all on function credit_wallet(uuid, bigint, text, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function credit_wallet(uuid, bigint, text, text, text, uuid, uuid) to service_role;

-- ── enqueue: charge + ledger + outbox, atomically ───────────────
-- Returns the outbox row id, or null when nothing was recorded (the studio
-- has not switched this event on for this channel, or there is no address).
-- Never lets the wallet go below minus its overdraft.
create or replace function enqueue_message(
  p_company     uuid,
  p_channel     text,
  p_to          text,
  p_template    text,
  p_vars        jsonb,
  p_entity_type text,
  p_entity_id   uuid,
  p_dedupe_key  text,
  p_event       text default null,
  p_recipient   uuid default null,
  p_subject     text default null,
  p_body        text default null,
  p_link        text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to       text;
  v_wallet   wallets;
  v_tpl      whatsapp_templates;
  v_price    messaging_prices;
  v_category text;
  v_cost     bigint := 0;
  v_meta     bigint := 0;
  v_free     boolean := false;
  v_used     int;
  v_id       uuid;
  v_bal      bigint;
  v_owner    uuid;
begin
  if p_channel not in ('whatsapp', 'email') then
    raise exception 'unknown channel' using errcode = '22023';
  end if;
  if p_event is not null and not exists (
    select 1 from messaging_settings s
     where s.company_id = p_company and s.event = p_event
       and case when p_channel = 'whatsapp' then s.whatsapp else s.email end
  ) then
    return null;
  end if;

  v_to := case when p_channel = 'whatsapp' then crm_normalize_phone(p_to)
               else nullif(lower(btrim(coalesce(p_to, ''))), '') end;
  if v_to is null or (p_channel = 'email' and v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    return null;
  end if;

  -- One studio's sends queue behind this lock: the balance check, the free
  -- email count and the debit all see the same wallet.
  perform wallet_ensure(p_company);
  select * into v_wallet from wallets where company_id = p_company for update;

  if p_dedupe_key is not null then
    select id into v_id from message_outbox
     where company_id = p_company and channel = p_channel and dedupe_key = p_dedupe_key;
    if found then return v_id; end if;
  end if;

  if p_channel = 'whatsapp' then
    select * into v_tpl from whatsapp_templates where key = p_template;
    v_category := coalesce(v_tpl.category, 'utility');
  else
    v_category := 'email';
  end if;

  if exists (select 1 from message_opt_outs where channel = p_channel and address = v_to) then
    insert into message_outbox (company_id, channel, category, to_address, recipient_uid, template_key, vars,
                                subject, body, link, status, entity_type, entity_id, dedupe_key, error)
      values (p_company, p_channel, v_category, v_to, p_recipient, p_template, coalesce(p_vars, '[]'::jsonb),
              p_subject, p_body, p_link, 'skipped_opt_out', p_entity_type, p_entity_id, p_dedupe_key,
              'This person asked not to get messages.')
      returning id into v_id;
    return v_id;
  end if;

  v_price := messaging_price_now(p_channel, v_category);
  if v_price.id is null then
    insert into message_outbox (company_id, channel, category, to_address, recipient_uid, template_key, vars,
                                subject, body, link, status, entity_type, entity_id, dedupe_key, error)
      values (p_company, p_channel, v_category, v_to, p_recipient, p_template, coalesce(p_vars, '[]'::jsonb),
              p_subject, p_body, p_link, 'failed', p_entity_type, p_entity_id, p_dedupe_key,
              'No price is set for this kind of message yet.')
      returning id into v_id;
    return v_id;
  end if;
  v_cost := messaging_price_paise(v_price.meta_cost_paise, v_price.markup_pct, v_price.markup_fixed_paise);
  v_meta := v_price.meta_cost_paise;

  if p_channel = 'email' then
    select count(*) into v_used from message_outbox
     where company_id = p_company and channel = 'email' and free_allowance
       and status not in ('failed', 'skipped_no_balance', 'skipped_opt_out')
       and created_at >= messaging_month_start();
    if v_used < v_price.free_monthly then
      v_free := true;
      v_cost := 0;
    end if;
  end if;

  if v_cost > 0 and v_wallet.balance_paise - v_cost < -v_wallet.overdraft_paise then
    insert into message_outbox (company_id, channel, category, to_address, recipient_uid, template_key, vars,
                                subject, body, link, status, entity_type, entity_id, dedupe_key, error)
      values (p_company, p_channel, v_category, v_to, p_recipient, p_template, coalesce(p_vars, '[]'::jsonb),
              p_subject, p_body, p_link, 'skipped_no_balance', p_entity_type, p_entity_id, p_dedupe_key,
              'Recharge to send.')
      returning id into v_id;
    select owner_user_id into v_owner from companies where id = p_company;
    if v_owner is not null then
      perform create_notification(
        p_company, v_owner, 'wallet.empty', 'Messages are not going out',
        'Your messaging balance is too low. Recharge to send WhatsApp messages again.',
        'wallet_empty:' || (now() at time zone 'Asia/Kolkata')::date, 'wallet', null, 'critical', '/settings/messaging');
    end if;
    return v_id;
  end if;

  if p_channel = 'whatsapp' and (v_tpl.id is null or v_tpl.status <> 'approved') then
    insert into message_outbox (company_id, channel, category, to_address, recipient_uid, template_key, vars,
                                subject, body, link, status, entity_type, entity_id, dedupe_key, error)
      values (p_company, p_channel, v_category, v_to, p_recipient, p_template, coalesce(p_vars, '[]'::jsonb),
              p_subject, p_body, p_link, 'failed', p_entity_type, p_entity_id, p_dedupe_key,
              'This message is waiting for WhatsApp approval. Nothing was charged.')
      returning id into v_id;
    return v_id;
  end if;

  insert into message_outbox (company_id, channel, category, to_address, recipient_uid, template_key, vars,
                              subject, body, link, status, cost_paise, meta_cost_paise, free_allowance,
                              entity_type, entity_id, dedupe_key)
    values (p_company, p_channel, v_category, v_to, p_recipient, p_template, coalesce(p_vars, '[]'::jsonb),
            p_subject, p_body, p_link, 'queued', v_cost, v_meta, v_free,
            p_entity_type, p_entity_id, p_dedupe_key)
    returning id into v_id;

  if v_cost > 0 then
    update wallets set balance_paise = balance_paise - v_cost, updated_at = now()
     where company_id = p_company
     returning balance_paise into v_bal;
    insert into wallet_ledger (company_id, kind, amount_paise, balance_after, source, message_id)
      values (p_company, 'debit', v_cost, v_bal, p_channel, v_id);
    perform wallet_warn_low(p_company, v_wallet.balance_paise, v_bal, v_wallet.low_balance_paise);
  end if;
  return v_id;
end;
$$;
revoke all on function enqueue_message(uuid, text, text, text, jsonb, text, uuid, text, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function enqueue_message(uuid, text, text, text, jsonb, text, uuid, text, text, uuid, text, text, text)
  to service_role;

-- ── the event hook: configured notifications go out as messages ──
create or replace function notifications_enqueue_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event  text := messaging_event_for_type(new.type);
  v_u      record;
  v_studio text;
  v_vars   jsonb;
  v_ch     text;
begin
  if v_event is null then
    return new;
  end if;
  -- A message is a copy of the notification. Nothing here may stop the
  -- notification itself from being written.
  begin
    if not exists (select 1 from messaging_settings
                    where company_id = new.company_id and event = v_event and (whatsapp or email)) then
      return new;
    end if;
    select u.name, u.phone, u.email into v_u
      from users u
     where u.user_id = new.recipient_uid and u.company_id = new.company_id
       and u.deleted_at is null and u.status = 'active';
    if not found then
      return new;
    end if;
    select coalesce(nullif(btrim(display_name), ''), name) into v_studio from companies where id = new.company_id;
    v_vars := jsonb_build_array(
      coalesce(split_part(btrim(v_u.name), ' ', 1), 'there'),
      coalesce(v_studio, 'your studio'),
      new.title,
      coalesce(nullif(btrim(new.body), ''), '-'));
    foreach v_ch in array array['whatsapp', 'email'] loop
      perform enqueue_message(
        new.company_id, v_ch,
        case when v_ch = 'whatsapp' then v_u.phone else v_u.email end,
        v_event, v_vars, new.entity_type, new.entity_id, 'n:' || new.id,
        v_event, new.recipient_uid,
        coalesce(v_studio, 'Your studio') || ': ' || new.title,
        new.body, new.deep_link);
    end loop;
  exception when others then
    raise warning 'messaging: could not queue a copy of notification %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function notifications_enqueue_messages() from public, anon, authenticated;
drop trigger if exists notifications_enqueue_messages on notifications;
create trigger notifications_enqueue_messages
  after insert on notifications
  for each row execute function notifications_enqueue_messages();

-- ── studio: owner actions ────────────────────────────────────────
create or replace function request_wallet_recharge(p_amount bigint, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id      uuid;
  v_studio  text;
begin
  if not (is_current_user_active() and is_current_owner()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_amount is null or p_amount < 10000 or p_amount > 10000000 then
    raise exception 'pick an amount between ₹100 and ₹1,00,000' using errcode = '22023';
  end if;
  if exists (select 1 from wallet_recharge_requests where company_id = v_company and status = 'pending') then
    raise exception 'you already have a recharge request waiting' using errcode = '22023';
  end if;
  insert into wallet_recharge_requests (company_id, amount_paise, note, requested_by)
    values (v_company, p_amount, nullif(btrim(p_note), ''), auth.uid())
    returning id into v_id;

  -- The platform team hears about it in their own studio's bell.
  select name into v_studio from companies where id = v_company;
  perform create_notification(
    u.company_id, pa.user_id, 'platform.recharge_request', coalesce(v_studio, 'A studio') || ' asked for a recharge',
    '₹' || to_char(p_amount / 100.0, 'FM999999990.00') || coalesce(' · ' || nullif(btrim(p_note), ''), ''),
    'recharge_request:' || v_id, 'wallet_recharge_request', v_id, 'info', '/platform/messaging')
  from platform_admins pa
  join users u on u.user_id = pa.user_id;
  return v_id;
end;
$$;
revoke all on function request_wallet_recharge(bigint, text) from public, anon;
grant execute on function request_wallet_recharge(bigint, text) to authenticated;

create or replace function cancel_wallet_recharge(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (is_current_user_active() and is_current_owner()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update wallet_recharge_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where id = p_id and company_id = get_current_company_id() and status = 'pending';
  if not found then
    raise exception 'that request cannot be cancelled now' using errcode = '22023';
  end if;
end;
$$;
revoke all on function cancel_wallet_recharge(uuid) from public, anon;
grant execute on function cancel_wallet_recharge(uuid) to authenticated;

create or replace function set_messaging_setting(p_event text, p_whatsapp boolean, p_email boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (is_current_user_active() and is_current_owner()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into messaging_settings (company_id, event, whatsapp, email, updated_at)
    values (get_current_company_id(), p_event, coalesce(p_whatsapp, false), coalesce(p_email, false), now())
  on conflict (company_id, event) do update
    set whatsapp = excluded.whatsapp, email = excluded.email, updated_at = now();
end;
$$;
revoke all on function set_messaging_setting(text, boolean, boolean) from public, anon;
grant execute on function set_messaging_setting(text, boolean, boolean) to authenticated;

create or replace function set_wallet_low_balance(p_paise bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_company uuid := get_current_company_id();
begin
  if not (is_current_user_active() and is_current_owner()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_paise is null or p_paise < 0 or p_paise > 10000000 then
    raise exception 'pick an amount between ₹0 and ₹1,00,000' using errcode = '22023';
  end if;
  perform wallet_ensure(v_company);
  update wallets set low_balance_paise = p_paise, updated_at = now() where company_id = v_company;
end;
$$;
revoke all on function set_wallet_low_balance(bigint) from public, anon;
grant execute on function set_wallet_low_balance(bigint) to authenticated;

-- What a studio pays per message. The price only: never Meta's cost or the markup.
create or replace function messaging_price_list()
returns table (channel text, category text, price_paise bigint, free_monthly int)
language sql
stable
security definer
set search_path = public
as $$
  select p.channel, p.category,
         messaging_price_paise(p.meta_cost_paise, p.markup_pct, p.markup_fixed_paise),
         p.free_monthly
    from (select distinct on (channel, category) *
            from messaging_prices
           where effective_from <= now()
           order by channel, category, effective_from desc, created_at desc) p
   where is_current_user_active()
   order by p.channel desc, p.category
$$;
revoke all on function messaging_price_list() from public, anon;
grant execute on function messaging_price_list() to authenticated;

-- "Send me a test": one message to the owner, charged like any other.
create or replace function send_test_message(p_channel text)
returns table (id uuid, status text, error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_u       record;
  v_studio  text;
  v_id      uuid;
begin
  if not (is_current_user_active() and is_current_owner()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select u.name, u.phone, u.email into v_u from users u where u.user_id = auth.uid() and u.company_id = v_company;
  select coalesce(nullif(btrim(display_name), ''), name) into v_studio from companies where companies.id = v_company;
  v_id := enqueue_message(
    v_company, p_channel, case when p_channel = 'whatsapp' then v_u.phone else v_u.email end,
    'test_message',
    jsonb_build_array(coalesce(split_part(btrim(v_u.name), ' ', 1), 'there'), coalesce(v_studio, 'your studio'), 'Test message', 'Messages from your studio are working.'),
    'wallet', null, 'test:' || gen_random_uuid(), null, auth.uid(),
    coalesce(v_studio, 'Your studio') || ': test message',
    'Messages from your studio are working.', '/settings/messaging');
  if v_id is null then
    raise exception 'add your % to your profile first', case when p_channel = 'whatsapp' then 'phone number' else 'email' end
      using errcode = '22023';
  end if;
  return query select o.id, o.status, o.error from message_outbox o where o.id = v_id;
end;
$$;
revoke all on function send_test_message(text) from public, anon;
grant execute on function send_test_message(text) to authenticated;

-- ── worker (service role, from /cron/messages) ───────────────────
create or replace function message_outbox_claim(p_limit int default 50)
returns table (
  id uuid, company_id uuid, channel text, to_address text, template_key text,
  meta_template_name text, language text, template_body text, vars jsonb,
  subject text, body text, link text, studio_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare v_stale uuid;
begin
  -- A worker that died mid-send: give the money back rather than guess.
  for v_stale in
    update message_outbox o set status = 'failed', error = 'Sending stopped half way. The charge was returned.'
     where o.status = 'sending' and o.claimed_at < now() - interval '30 minutes'
     returning o.id
  loop
    perform wallet_refund_message(v_stale, 'Sending stopped half way');
  end loop;

  return query
    with picked as (
      select o.id from message_outbox o
       where o.status = 'queued'
       order by o.created_at
       limit greatest(1, least(coalesce(p_limit, 50), 200))
       for update skip locked
    ), claimed as (
      update message_outbox o
         set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
        from picked where o.id = picked.id
      returning o.*
    )
    select c.id, c.company_id, c.channel, c.to_address, c.template_key,
           t.meta_template_name, t.language, t.body, c.vars,
           c.subject, c.body, c.link, co.name
      from claimed c
      join companies co on co.id = c.company_id
      left join whatsapp_templates t on t.key = c.template_key;
end;
$$;
revoke all on function message_outbox_claim(int) from public, anon, authenticated;
grant execute on function message_outbox_claim(int) to service_role;

create or replace function message_outbox_result(p_id uuid, p_ok boolean, p_provider_id text, p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ok then
    update message_outbox
       set status = 'sent', sent_at = now(), provider_message_id = nullif(p_provider_id, ''), error = null
     where id = p_id and status = 'sending';
  else
    update message_outbox
       set status = 'failed', error = left(coalesce(nullif(p_error, ''), 'Could not send.'), 500)
     where id = p_id and status = 'sending';
    if found then
      perform wallet_refund_message(p_id, left(coalesce(nullif(p_error, ''), 'Could not send'), 200));
    end if;
  end if;
end;
$$;
revoke all on function message_outbox_result(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function message_outbox_result(uuid, boolean, text, text) to service_role;

-- Meta's delivery receipts. Only moves forward; a failure refunds (Meta does
-- not charge for a message it could not deliver).
create or replace function message_status_update(p_provider_id text, p_status text, p_error text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from message_outbox where provider_message_id = p_provider_id and channel = 'whatsapp' for update;
  if not found then
    return false;
  end if;
  if p_status = 'delivered' then
    update message_outbox set status = 'delivered', delivered_at = coalesce(delivered_at, now())
     where id = v_id and status in ('sending', 'sent');
  elsif p_status = 'read' then
    update message_outbox set status = 'read', read_at = coalesce(read_at, now()),
           delivered_at = coalesce(delivered_at, now())
     where id = v_id and status in ('sending', 'sent', 'delivered');
  elsif p_status = 'failed' then
    update message_outbox set status = 'failed', error = left(coalesce(nullif(p_error, ''), 'WhatsApp could not deliver it.'), 500)
     where id = v_id and status in ('sending', 'sent');
    if found then
      perform wallet_refund_message(v_id, 'WhatsApp could not deliver it');
    end if;
  end if;
  return true;
end;
$$;
revoke all on function message_status_update(text, text, text) from public, anon, authenticated;
grant execute on function message_status_update(text, text, text) to service_role;

-- Someone replied STOP (or START) to the platform's number.
create or replace function message_opt_out_set(p_address text, p_out boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_to text := crm_normalize_phone(p_address);
begin
  if v_to is null then return; end if;
  if p_out then
    insert into message_opt_outs (channel, address) values ('whatsapp', v_to) on conflict do nothing;
  else
    delete from message_opt_outs where channel = 'whatsapp' and address = v_to;
  end if;
end;
$$;
revoke all on function message_opt_out_set(text, boolean) from public, anon, authenticated;
grant execute on function message_opt_out_set(text, boolean) to service_role;

-- ── platform console (platform_admins only) ──────────────────────
create or replace function platform_messaging_wallets()
returns table (
  company_id uuid, company_name text, balance_paise bigint, low_balance_paise bigint, overdraft_paise bigint,
  pending_requests int, month_whatsapp int, month_emails int, month_charged_paise bigint, last_activity timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select c.id, c.name, coalesce(w.balance_paise, 0), coalesce(w.low_balance_paise, 10000), coalesce(w.overdraft_paise, 0),
           (select count(*)::int from wallet_recharge_requests r where r.company_id = c.id and r.status = 'pending'),
           (select count(*)::int from message_outbox o where o.company_id = c.id and o.channel = 'whatsapp'
               and o.status in ('queued', 'sending', 'sent', 'delivered', 'read') and o.created_at >= messaging_month_start()),
           (select count(*)::int from message_outbox o where o.company_id = c.id and o.channel = 'email'
               and o.status in ('queued', 'sending', 'sent', 'delivered', 'read') and o.created_at >= messaging_month_start()),
           (select coalesce(sum(o.cost_paise), 0)::bigint from message_outbox o where o.company_id = c.id
               and o.status in ('queued', 'sending', 'sent', 'delivered', 'read') and o.created_at >= messaging_month_start()),
           greatest(w.updated_at, (select max(l.created_at) from wallet_ledger l where l.company_id = c.id))
      from companies c
      left join wallets w on w.company_id = c.id
     order by coalesce(w.balance_paise, 0) desc, c.name;
end;
$$;
revoke all on function platform_messaging_wallets() from public, anon;
grant execute on function platform_messaging_wallets() to authenticated;

create or replace function platform_recharge_requests(p_status text)
returns table (
  id uuid, company_id uuid, company_name text, amount_paise bigint, note text, status text,
  requested_by_name text, created_at timestamptz, decided_at timestamptz, admin_note text, balance_paise bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select r.id, r.company_id, c.name, r.amount_paise, r.note, r.status, u.name, r.created_at, r.decided_at,
           r.admin_note, coalesce(w.balance_paise, 0)
      from wallet_recharge_requests r
      join companies c on c.id = r.company_id
      left join users u on u.user_id = r.requested_by
      left join wallets w on w.company_id = r.company_id
     where p_status is null or r.status = p_status
     order by (r.status = 'pending') desc, r.created_at desc
     limit 300;
end;
$$;
revoke all on function platform_recharge_requests(text) from public, anon;
grant execute on function platform_recharge_requests(text) to authenticated;

create or replace function platform_credit_wallet(p_company uuid, p_amount bigint, p_reference text, p_note text, p_request uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(p_reference), '') is null then
    raise exception 'add the payment reference (UTR or receipt number)' using errcode = '22023';
  end if;
  return credit_wallet(p_company, p_amount, 'recharge_manual', p_reference, p_note, p_request, auth.uid());
end;
$$;
revoke all on function platform_credit_wallet(uuid, bigint, text, text, uuid) from public, anon;
grant execute on function platform_credit_wallet(uuid, bigint, text, text, uuid) to authenticated;

-- A correction either way. Positive adds, negative takes away (never below
-- minus the overdraft). The reason is required and kept in the ledger.
create or replace function platform_adjust_wallet(p_company uuid, p_amount bigint, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_w   wallets;
  v_bal bigint;
  v_id  uuid;
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if nullif(btrim(p_note), '') is null then
    raise exception 'say why' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 10000000 then
    raise exception 'the amount must be between ₹0.01 and ₹1,00,000' using errcode = '22023';
  end if;
  if p_amount > 0 then
    return credit_wallet(p_company, p_amount, 'adjustment', null, p_note, null, auth.uid());
  end if;
  perform wallet_ensure(p_company);
  select * into v_w from wallets where company_id = p_company for update;
  if v_w.balance_paise + p_amount < -v_w.overdraft_paise then
    raise exception 'that would take the balance below zero' using errcode = '22023';
  end if;
  update wallets set balance_paise = balance_paise + p_amount, updated_at = now()
   where company_id = p_company returning balance_paise into v_bal;
  insert into wallet_ledger (company_id, kind, amount_paise, balance_after, source, note, created_by)
    values (p_company, 'debit', -p_amount, v_bal, 'adjustment', btrim(p_note), auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function platform_adjust_wallet(uuid, bigint, text) from public, anon;
grant execute on function platform_adjust_wallet(uuid, bigint, text) to authenticated;

create or replace function platform_set_wallet_overdraft(p_company uuid, p_paise bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_paise is null or p_paise < 0 or p_paise > 100000 then
    raise exception 'the overdraft must be between ₹0 and ₹1,000' using errcode = '22023';
  end if;
  perform wallet_ensure(p_company);
  update wallets set overdraft_paise = p_paise, updated_at = now() where company_id = p_company;
end;
$$;
revoke all on function platform_set_wallet_overdraft(uuid, bigint) from public, anon;
grant execute on function platform_set_wallet_overdraft(uuid, bigint) to authenticated;

create or replace function platform_reject_recharge(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_r wallet_recharge_requests;
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update wallet_recharge_requests
     set status = 'rejected', decided_at = now(), decided_by = auth.uid(), admin_note = nullif(btrim(p_note), '')
   where id = p_id and status = 'pending'
   returning * into v_r;
  if not found then
    raise exception 'that request is not pending' using errcode = '22023';
  end if;
  perform create_notification(
    v_r.company_id, c.owner_user_id, 'wallet.request_rejected', 'Recharge request not completed',
    coalesce(nullif(btrim(p_note), ''), 'Contact support to recharge your messaging wallet.'),
    'recharge_rejected:' || p_id, 'wallet', null, 'warning', '/settings/messaging')
  from companies c where c.id = v_r.company_id and c.owner_user_id is not null;
end;
$$;
revoke all on function platform_reject_recharge(uuid, text) from public, anon;
grant execute on function platform_reject_recharge(uuid, text) to authenticated;

create or replace function platform_set_messaging_price(
  p_channel text, p_category text, p_cost int, p_pct numeric, p_fixed int, p_free_monthly int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into messaging_prices (channel, category, meta_cost_paise, markup_pct, markup_fixed_paise, free_monthly, created_by)
    values (p_channel, p_category, p_cost, p_pct, p_fixed, case when p_channel = 'email' then coalesce(p_free_monthly, 0) else 0 end, auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function platform_set_messaging_price(text, text, int, numeric, int, int) from public, anon;
grant execute on function platform_set_messaging_price(text, text, int, numeric, int, int) to authenticated;

create or replace function platform_save_whatsapp_template(
  p_key text, p_name text, p_meta_name text, p_language text, p_category text,
  p_body text, p_variables jsonb, p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into whatsapp_templates (key, name, meta_template_name, language, category, body, variables, status, updated_by, updated_at)
    values (p_key, btrim(p_name), p_meta_name, coalesce(p_language, 'en'), coalesce(p_category, 'utility'), p_body,
            coalesce(p_variables, '[]'::jsonb), coalesce(p_status, 'pending'), auth.uid(), now())
  on conflict (key) do update
    set name = excluded.name, meta_template_name = excluded.meta_template_name, language = excluded.language,
        category = excluded.category, body = excluded.body, variables = excluded.variables,
        status = excluded.status, updated_by = excluded.updated_by, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function platform_save_whatsapp_template(text, text, text, text, text, text, jsonb, text) from public, anon;
grant execute on function platform_save_whatsapp_template(text, text, text, text, text, text, jsonb, text) to authenticated;

create or replace function platform_message_outbox(p_status text, p_limit int)
returns table (
  id uuid, company_id uuid, company_name text, channel text, to_address text, template_key text, status text,
  cost_paise bigint, error text, created_at timestamptz, sent_at timestamptz, refunded boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select o.id, o.company_id, c.name, o.channel, o.to_address, o.template_key, o.status,
           o.cost_paise, o.error, o.created_at, o.sent_at, o.refunded_at is not null
      from message_outbox o
      join companies c on c.id = o.company_id
     where p_status is null or o.status = p_status
     order by o.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;
revoke all on function platform_message_outbox(text, int) from public, anon;
grant execute on function platform_message_outbox(text, int) to authenticated;
