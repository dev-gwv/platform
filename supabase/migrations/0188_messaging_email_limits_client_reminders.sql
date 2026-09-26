-- Messaging, second pass: email first, WhatsApp later.
--
--   * WhatsApp is set aside for now. A platform-level switch
--     (messaging_platform_settings.whatsapp_enabled, off by default) turns it
--     back on from the platform console. While it is off, enqueue_message()
--     for WhatsApp returns null and writes nothing: no charge, no outbox row.
--     All the WhatsApp code stays in place for later.
--   * Emails: 100 free per studio per month (was 500). A new price row, so the
--     history keeps the old allowance and when it changed.
--   * A monthly email cap per studio (wallets.email_monthly_cap, 10,000 by
--     default, set per studio by the platform). Past it, an email is recorded
--     as skipped_limit ("Monthly email limit reached"), never charged, and the
--     owner hears about it once that month.
--   * Payment reminders to clients (event client_payment_due): the hourly
--     cron emails a client 3 days before an invoice is due, on the day, and
--     3 and 10 days after, while money is still due. The studio switches it on
--     in Settings → Messaging. A billing user can also send one by hand from
--     the invoice (send_client_payment_reminder), charged the same way.
--
-- The client's invoice link is NOT put in these emails: only a hash of the
-- share token is stored (access_tokens), and making a new link would retire
-- the one the client already has. The email names the studio's phone and
-- email instead.

-- ── the platform switch ─────────────────────────────────────────
create table if not exists messaging_platform_settings (
  id               boolean primary key default true check (id),
  whatsapp_enabled boolean not null default false,
  updated_by       uuid,
  updated_at       timestamptz not null default now()
);
insert into messaging_platform_settings (id) values (true) on conflict (id) do nothing;

alter table messaging_platform_settings enable row level security;
drop policy if exists messaging_platform_settings_select on messaging_platform_settings;
-- Not a secret: every screen needs to know whether to show WhatsApp at all.
create policy messaging_platform_settings_select on messaging_platform_settings
  for select to authenticated using (true);
grant select on messaging_platform_settings to authenticated;
revoke insert, update, delete, truncate on messaging_platform_settings from authenticated, anon;

create or replace function messaging_whatsapp_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select whatsapp_enabled from messaging_platform_settings where id), false)
$$;
revoke all on function messaging_whatsapp_enabled() from public, anon;
grant execute on function messaging_whatsapp_enabled() to authenticated, service_role;

create or replace function platform_set_whatsapp_enabled(p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into messaging_platform_settings (id, whatsapp_enabled, updated_by, updated_at)
    values (true, coalesce(p_on, false), auth.uid(), now())
  on conflict (id) do update
    set whatsapp_enabled = excluded.whatsapp_enabled, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function platform_set_whatsapp_enabled(boolean) from public, anon;
grant execute on function platform_set_whatsapp_enabled(boolean) to authenticated;

-- ── 100 free emails a month ─────────────────────────────────────
-- A new price row (the price list keeps its history). Only when the current
-- email price still carries the seeded 500, or there is none at all, so a
-- value the platform admin already chose is left alone. clock_timestamp()
-- for created_at: in a single deploy transaction both rows share now(), and
-- the newer created_at is what makes this one the current price.
insert into messaging_prices (channel, category, meta_cost_paise, markup_pct, markup_fixed_paise, free_monthly, created_at)
select 'email', 'email', coalesce(p.meta_cost_paise, 0), coalesce(p.markup_pct, 0), coalesce(p.markup_fixed_paise, 20), 100,
       clock_timestamp()
  from (select 1) one
  left join lateral (
    select * from messaging_prices
     where channel = 'email' and category = 'email' and effective_from <= now()
     order by effective_from desc, created_at desc
     limit 1
  ) p on true
 where p.id is null or p.free_monthly = 500;

-- ── monthly email cap per studio ────────────────────────────────
alter table wallets add column if not exists email_monthly_cap int not null default 10000
  check (email_monthly_cap between 0 and 1000000);

create or replace function platform_set_email_cap(p_company uuid, p_cap int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_cap is null or p_cap < 0 or p_cap > 1000000 then
    raise exception 'the limit must be between 0 and 10,00,000 emails' using errcode = '22023';
  end if;
  if not exists (select 1 from companies where id = p_company) then
    raise exception 'studio not found' using errcode = 'P0002';
  end if;
  perform wallet_ensure(p_company);
  update wallets set email_monthly_cap = p_cap, updated_at = now() where company_id = p_company;
end;
$$;
revoke all on function platform_set_email_cap(uuid, int) from public, anon;
grant execute on function platform_set_email_cap(uuid, int) to authenticated;

-- ── status and event lists ──────────────────────────────────────
alter table message_outbox drop constraint if exists message_outbox_status_check;
alter table message_outbox add constraint message_outbox_status_check
  check (status in ('queued', 'sending', 'sent', 'delivered', 'read', 'failed',
                    'skipped_no_balance', 'skipped_opt_out', 'skipped_limit'));

alter table messaging_settings drop constraint if exists messaging_settings_event_check;
alter table messaging_settings add constraint messaging_settings_event_check
  check (event in ('start_reminder', 'leave_decided', 'payslip_ready', 'shoot_tomorrow', 'client_payment_due'));

-- Finding an invoice's reminders (last sent, the double-click guard).
create index if not exists message_outbox_entity_idx
  on message_outbox (entity_id, created_at desc) where entity_type = 'invoice';

-- ── low balance: the words no longer promise WhatsApp ───────────
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
    'Balance is ₹' || to_char(p_after / 100.0, 'FM999999990.00') || '. Recharge so your messages keep going out.',
    'wallet_low:' || (now() at time zone 'Asia/Kolkata')::date, 'wallet', null, 'warning', '/settings/messaging');
end;
$$;
revoke all on function wallet_warn_low(uuid, bigint, bigint, bigint) from public, anon, authenticated;

-- Emails a studio has sent (or is sending) this calendar month, India time.
-- Failed and skipped ones do not count.
create or replace function messaging_month_emails(p_company uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from message_outbox
   where company_id = p_company and channel = 'email'
     and status in ('queued', 'sending', 'sent', 'delivered', 'read')
     and created_at >= messaging_month_start()
$$;
revoke all on function messaging_month_emails(uuid) from public, anon, authenticated;

-- ── enqueue: as 0186, plus the WhatsApp switch and the email cap ─
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
  -- WhatsApp is switched off for the whole platform: nothing is written.
  if p_channel = 'whatsapp' and not messaging_whatsapp_enabled() then
    return null;
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
  -- email count, the monthly cap and the debit all see the same wallet.
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

  -- The monthly email cap: recorded, never charged, the owner told once a month.
  if p_channel = 'email' and messaging_month_emails(p_company) >= v_wallet.email_monthly_cap then
    insert into message_outbox (company_id, channel, category, to_address, recipient_uid, template_key, vars,
                                subject, body, link, status, entity_type, entity_id, dedupe_key, error)
      values (p_company, p_channel, v_category, v_to, p_recipient, p_template, coalesce(p_vars, '[]'::jsonb),
              p_subject, p_body, p_link, 'skipped_limit', p_entity_type, p_entity_id, p_dedupe_key,
              'Monthly email limit reached.')
      returning id into v_id;
    select owner_user_id into v_owner from companies where id = p_company;
    if v_owner is not null then
      perform create_notification(
        p_company, v_owner, 'wallet.email_limit', 'Monthly email limit reached',
        'Your studio has sent ' || to_char(v_wallet.email_monthly_cap, 'FM99,99,99,990') ||
        ' emails this month. More emails start again on the 1st. Contact IPC Studios support to raise the limit.',
        'email_limit:' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM'), 'wallet', null, 'warning', '/settings/messaging');
    end if;
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
       and status not in ('failed', 'skipped_no_balance', 'skipped_opt_out', 'skipped_limit')
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
        'Your messaging balance is too low. Recharge to send messages again.',
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

-- ── studio settings: WhatsApp stays as it was while it is off ────
-- While the platform has WhatsApp off, a save leaves the stored WhatsApp
-- choice alone (the screen does not show it). Client payment reminders are
-- email only: there is no WhatsApp template for them.
create or replace function set_messaging_setting(p_event text, p_whatsapp boolean, p_email boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_wa boolean := messaging_whatsapp_enabled() and p_event <> 'client_payment_due';
begin
  if not (is_current_user_active() and is_current_owner()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into messaging_settings (company_id, event, whatsapp, email, updated_at)
    values (get_current_company_id(), p_event, v_wa and coalesce(p_whatsapp, false), coalesce(p_email, false), now())
  on conflict (company_id, event) do update
    set whatsapp = case when v_wa then excluded.whatsapp
                        when p_event = 'client_payment_due' then false
                        else messaging_settings.whatsapp end,
        email = excluded.email, updated_at = now();
end;
$$;
revoke all on function set_messaging_setting(text, boolean, boolean) from public, anon;
grant execute on function set_messaging_setting(text, boolean, boolean) to authenticated;

-- "Send me a test": WhatsApp says so plainly while it is off.
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
  if p_channel = 'whatsapp' and not messaging_whatsapp_enabled() then
    raise exception 'WhatsApp messages are not available yet' using errcode = '22023';
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

-- ── platform console: wallets with the cap, and month totals ─────
drop function if exists platform_messaging_wallets();
create or replace function platform_messaging_wallets()
returns table (
  company_id uuid, company_name text, balance_paise bigint, low_balance_paise bigint, overdraft_paise bigint,
  pending_requests int, month_whatsapp int, month_emails int, month_charged_paise bigint, last_activity timestamptz,
  email_monthly_cap int
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
           messaging_month_emails(c.id),
           (select coalesce(sum(o.cost_paise), 0)::bigint from message_outbox o where o.company_id = c.id
               and o.status in ('queued', 'sending', 'sent', 'delivered', 'read') and o.created_at >= messaging_month_start()),
           greatest(w.updated_at, (select max(l.created_at) from wallet_ledger l where l.company_id = c.id)),
           coalesce(w.email_monthly_cap, 10000)
      from companies c
      left join wallets w on w.company_id = c.id
     order by coalesce(w.balance_paise, 0) desc, c.name;
end;
$$;
revoke all on function platform_messaging_wallets() from public, anon;
grant execute on function platform_messaging_wallets() to authenticated;

-- The whole platform this month: what the email provider's quota is spent on.
create or replace function platform_messaging_totals()
returns table (whatsapp_enabled boolean, month_emails int, month_whatsapp int, month_skipped_limit int)
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
    select messaging_whatsapp_enabled(),
           count(*) filter (where o.channel = 'email' and o.status in ('queued', 'sending', 'sent', 'delivered', 'read'))::int,
           count(*) filter (where o.channel = 'whatsapp' and o.status in ('queued', 'sending', 'sent', 'delivered', 'read'))::int,
           count(*) filter (where o.status = 'skipped_limit')::int
      from message_outbox o
     where o.created_at >= messaging_month_start();
end;
$$;
revoke all on function platform_messaging_totals() from public, anon;
grant execute on function platform_messaging_totals() to authenticated;

-- ── payment reminders to clients ────────────────────────────────

-- "₹1,23,456.50" (Indian grouping; whole rupees drop the paise).
create or replace function messaging_format_inr(p numeric)
returns text
language sql
immutable
as $$
  select case when coalesce(p, 0) < 0 then '-' else '' end || '₹' ||
         case when length(w) > 3
              then regexp_replace(left(w, length(w) - 3), '(\d)(?=(\d\d)+$)', '\1,', 'g') || ',' || right(w, 3)
              else w end ||
         case when f = '00' then '' else '.' || f end
    from (select trunc(abs(round(coalesce(p, 0), 2)))::bigint::text as w,
                 lpad(((round(abs(coalesce(p, 0)) * 100))::bigint % 100)::text, 2, '0') as f) x
$$;

-- Which reminder a day is, counted from the due date: 3 days before, on the
-- day, 3 and 10 days after. Null on any other day. Mirrors
-- paymentReminderStage() in packages/domain.
create or replace function client_payment_due_stage(p_due date, p_today date)
returns text
language sql
immutable
as $$
  select case p_today - p_due
    when -3 then 'before_3'
    when 0  then 'due'
    when 3  then 'after_3'
    when 10 then 'after_10'
  end
$$;

-- The email itself: to, subject and a warm plain-English body. Internal.
create or replace function client_payment_due_email(p_invoice uuid, p_today date)
returns table (to_address text, subject text, body text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_r      record;
  v_studio text;
  v_when   text;
  v_ask    text;
  v_reach  text;
begin
  select i.invoice_number, i.due_date, i.balance_due, i.company_id,
         nullif(btrim(cl.name), '') as client_name, nullif(btrim(cl.email), '') as client_email,
         coalesce(nullif(btrim(co.display_name), ''), co.name) as studio,
         coalesce(nullif(btrim(co.invoice_phone), ''), nullif(btrim(ow.phone), '')) as studio_phone,
         coalesce(nullif(btrim(co.invoice_email), ''), nullif(btrim(ow.email), '')) as studio_email
    into v_r
    from invoices i
    left join clients cl on cl.id = i.client_id
    join companies co on co.id = i.company_id
    left join users ow on ow.user_id = co.owner_user_id and ow.company_id = co.id
   where i.id = p_invoice;
  if not found then
    return;
  end if;
  v_studio := coalesce(v_r.studio, 'your studio');

  if v_r.due_date is null then
    v_when := 'is still pending.';
  elsif v_r.due_date > p_today then
    v_when := 'is due on ' || to_char(v_r.due_date, 'FMDD Mon YYYY') || '.';
  elsif v_r.due_date = p_today then
    v_when := 'is due today.';
  else
    v_when := 'was due on ' || to_char(v_r.due_date, 'FMDD Mon YYYY') || '.';
  end if;
  v_ask := case when v_r.due_date is not null and v_r.due_date < p_today
                then 'If you have already paid, thank you, and please ignore this email. If not, we would be grateful if you could pay at the earliest.'
                else 'We would be grateful if you could pay by the due date.' end;
  v_reach := case
    when v_r.studio_phone is not null and v_r.studio_email is not null
      then 'call us on ' || v_r.studio_phone || ' or write to ' || v_r.studio_email
    when v_r.studio_phone is not null then 'call us on ' || v_r.studio_phone
    when v_r.studio_email is not null then 'write to ' || v_r.studio_email
    else 'reply to ' || v_studio end;

  return query select
    v_r.client_email,
    'Payment reminder: Invoice ' || v_r.invoice_number || ' from ' || v_studio,
    'Dear ' || coalesce(v_r.client_name, 'Sir or Madam') || ',' || E'\n\n' ||
    'This is a gentle reminder from ' || v_studio || ' about invoice ' || v_r.invoice_number || '. ' ||
    'An amount of ' || messaging_format_inr(v_r.balance_due) || ' ' || v_when || E'\n\n' ||
    'Invoice: ' || v_r.invoice_number || E'\n' ||
    'Amount due: ' || messaging_format_inr(v_r.balance_due) || E'\n' ||
    case when v_r.due_date is not null then 'Due date: ' || to_char(v_r.due_date, 'FMDD Mon YYYY') || E'\n' else '' end ||
    E'\n' || v_ask || ' If you have any questions about this invoice, please ' || v_reach || '.' || E'\n\n' ||
    'Thank you,' || E'\n' || v_studio;
end;
$$;
revoke all on function client_payment_due_email(uuid, date) from public, anon, authenticated;

-- The hourly cron's part. After 10 am India time, each stage once per invoice
-- (per due date, so a moved due date starts over). Only invoices with money
-- still due: sent or part-paid, never draft, paid or cancelled. The studio's
-- toggle (event client_payment_due, email) is checked by enqueue_message.
create or replace function run_client_payment_due_cron(p_dry_run boolean default false, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local   timestamp := p_now at time zone 'Asia/Kolkata';
  v_today   date := v_local::date;
  v_due     int := 0;
  v_queued  int := 0;
  v_other   int := 0;
  v_r       record;
  v_mail    record;
  v_key     text;
  v_id      uuid;
  v_status  text;
  v_summary jsonb;
  v_run     uuid;
begin
  insert into cron_runs (job_name, dry_run) values ('client_payment_due_cron', p_dry_run) returning id into v_run;

  if extract(hour from v_local) >= 10 then
    for v_r in
      select i.id, i.company_id, i.due_date, client_payment_due_stage(i.due_date, v_today) as stage
        from invoices i
        join clients cl on cl.id = i.client_id
        join messaging_settings s on s.company_id = i.company_id and s.event = 'client_payment_due' and s.email
       where i.status in ('sent', 'partial')
         and i.balance_due > 0
         and i.due_date between v_today - 10 and v_today + 3
         and client_payment_due_stage(i.due_date, v_today) is not null
         and nullif(btrim(cl.email), '') is not null
    loop
      v_key := 'pay_due:' || v_r.id || ':' || v_r.stage || ':' || v_r.due_date;
      continue when exists (select 1 from message_outbox o
                             where o.company_id = v_r.company_id and o.channel = 'email' and o.dedupe_key = v_key);
      v_due := v_due + 1;
      if not p_dry_run then
        select * into v_mail from client_payment_due_email(v_r.id, v_today);
        v_id := enqueue_message(
          v_r.company_id, 'email', v_mail.to_address, 'client_payment_due',
          jsonb_build_array(v_r.stage), 'invoice', v_r.id, v_key, 'client_payment_due', null,
          v_mail.subject, v_mail.body, null);
        select o.status into v_status from message_outbox o where o.id = v_id;
        if v_status = 'queued' then v_queued := v_queued + 1; else v_other := v_other + 1; end if;
      end if;
    end loop;
  end if;

  v_summary := jsonb_build_object('due', v_due, 'queued', v_queued, 'not_sent', v_other, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;
revoke all on function run_client_payment_due_cron(boolean, timestamptz) from public, anon, authenticated;
grant execute on function run_client_payment_due_cron(boolean, timestamptz) to service_role;

-- "Send payment reminder" on an invoice: an explicit action, so the studio's
-- automatic-reminder toggle does not apply, but the charge and the monthly
-- cap do. The API checks billing.edit. A second click within 10 minutes
-- returns the first reminder instead of sending again (the invoice row lock
-- makes two clicks at once wait for each other).
create or replace function send_client_payment_reminder(p_invoice uuid)
returns table (id uuid, status text, error text, cost_paise bigint, free_allowance boolean, repeated boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_inv     record;
  v_mail    record;
  v_id      uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select i.id, i.status, i.balance_due into v_inv
    from invoices i where i.id = p_invoice and i.company_id = v_company
     for update;
  if not found then
    raise exception 'that invoice was not found' using errcode = 'P0002';
  end if;
  if v_inv.status = 'draft' then
    raise exception 'this invoice is still a draft. Send it first' using errcode = '22023';
  end if;
  if v_inv.status in ('paid', 'cancelled') or v_inv.balance_due <= 0 then
    raise exception 'nothing is due on this invoice' using errcode = '22023';
  end if;

  select * into v_mail from client_payment_due_email(p_invoice, (now() at time zone 'Asia/Kolkata')::date);
  if v_mail.to_address is null then
    return query select null::uuid, 'no_email'::text, 'Add the client''s email first.'::text, 0::bigint, false, false;
    return;
  end if;

  select o.id into v_id from message_outbox o
   where o.company_id = v_company and o.entity_type = 'invoice' and o.entity_id = p_invoice
     and o.channel = 'email' and o.dedupe_key like 'pay_remind:%'
     and o.created_at > now() - interval '10 minutes'
     and o.status not in ('failed', 'skipped_no_balance')
   order by o.created_at desc
   limit 1;
  if found then
    return query select o.id, o.status, o.error, o.cost_paise, o.free_allowance, true
                   from message_outbox o where o.id = v_id;
    return;
  end if;

  v_id := enqueue_message(
    v_company, 'email', v_mail.to_address, 'client_payment_due', '["manual"]'::jsonb,
    'invoice', p_invoice, 'pay_remind:' || p_invoice || ':' || gen_random_uuid(), null, auth.uid(),
    v_mail.subject, v_mail.body, null);
  if v_id is null then
    return query select null::uuid, 'no_email'::text, 'The client''s email does not look right.'::text, 0::bigint, false, false;
    return;
  end if;
  return query select o.id, o.status, o.error, o.cost_paise, o.free_allowance, false
                 from message_outbox o where o.id = v_id;
end;
$$;
revoke all on function send_client_payment_reminder(uuid) from public, anon;
grant execute on function send_client_payment_reminder(uuid) to authenticated;

-- What a reminder on this invoice would cost now, and when the last one went.
-- Readable by anyone in the studio who can see the invoice (the outbox itself
-- is owner-only).
create or replace function client_payment_reminder_quote(p_invoice uuid)
returns table (
  client_email text, price_paise bigint, free_monthly int, free_used int, month_emails int, email_monthly_cap int,
  can_afford boolean, auto_on boolean, last_sent_at timestamptz, reminders_sent int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_price   messaging_prices;
  v_w       wallets;
  v_cost    bigint;
  v_used    int;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from invoices i where i.id = p_invoice and i.company_id = v_company) then
    raise exception 'that invoice was not found' using errcode = 'P0002';
  end if;
  v_price := messaging_price_now('email', 'email');
  v_cost := case when v_price.id is null then 0
                 else messaging_price_paise(v_price.meta_cost_paise, v_price.markup_pct, v_price.markup_fixed_paise) end;
  select * into v_w from wallets w where w.company_id = v_company;
  select count(*)::int into v_used from message_outbox o
   where o.company_id = v_company and o.channel = 'email' and o.free_allowance
     and o.status not in ('failed', 'skipped_no_balance', 'skipped_opt_out', 'skipped_limit')
     and o.created_at >= messaging_month_start();
  return query
    select nullif(btrim(cl.email), ''),
           v_cost,
           coalesce(v_price.free_monthly, 0),
           v_used,
           messaging_month_emails(v_company),
           coalesce(v_w.email_monthly_cap, 10000),
           (v_used < coalesce(v_price.free_monthly, 0) or v_cost = 0
              or coalesce(v_w.balance_paise, 0) - v_cost >= -coalesce(v_w.overdraft_paise, 0)),
           exists (select 1 from messaging_settings s where s.company_id = v_company
                      and s.event = 'client_payment_due' and s.email),
           (select max(o.created_at) from message_outbox o
             where o.entity_type = 'invoice' and o.entity_id = p_invoice and o.company_id = v_company
               and o.template_key = 'client_payment_due'
               and o.status in ('queued', 'sending', 'sent', 'delivered', 'read')),
           (select count(*)::int from message_outbox o
             where o.entity_type = 'invoice' and o.entity_id = p_invoice and o.company_id = v_company
               and o.template_key = 'client_payment_due'
               and o.status in ('queued', 'sending', 'sent', 'delivered', 'read'))
      from invoices i
      left join clients cl on cl.id = i.client_id
     where i.id = p_invoice;
end;
$$;
revoke all on function client_payment_reminder_quote(uuid) from public, anon;
grant execute on function client_payment_reminder_quote(uuid) to authenticated;
