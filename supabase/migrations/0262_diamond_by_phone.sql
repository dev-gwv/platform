-- 0262: two price lists, and IPC Diamond membership checked by phone number
-- (owner, 14 Oct).
--
--   * IPC Diamond members pay Starter ₹1,499, Pro ₹2,499 and Studio Max
--     ₹3,999 a month (billed yearly; ₹1,999 / ₹2,999 / ₹4,999 month to month).
--     These are the tier rows of 0241/0242, now for the 'diamond' audience.
--   * Everyone else pays double: ₹2,999 / ₹4,999 / ₹7,999 a month billed
--     yearly, ₹3,999 / ₹5,999 / ₹9,999 month to month -- new '<key>_regular'
--     rows for the 'outsider' audience, same limits and same features.
--   * The old member plans (₹1,999 / ₹18,000 / ₹33,000, 0214) come off sale.
--     A studio on one keeps it until it ends; nothing here touches companies.
--   * No more screenshot. The platform owner keeps the member list in a
--     Google Sheet; the app copies its phone numbers into diamond_roster every
--     hour (lib/diamond-sheet.ts). An owner types their registered mobile
--     number, and a match makes the studio Diamond: member prices and a
--     30-day trial from sign-up, exactly as an approved screenshot did.
--   * One number opens one studio, and ten tries a day is the most a studio
--     gets, so the list cannot be guessed through.
--   * Talk to us on WhatsApp goes to 91 91091 92065.

-- ── the two price lists ──────────────────────────────────────────────
update plans
   set audience = 'diamond', updated_at = now()
 where key in ('starter_yearly', 'starter_monthly', 'pro_yearly', 'pro_monthly', 'max_yearly', 'max_monthly');

update plans
   set is_active = false, updated_at = now()
 where audience = 'diamond' and tier is null;

update plans
   set features = jsonb_build_array('Everything unlimited', 'Your own name and logo (white label)', 'Priority help'),
       updated_at = now()
 where key in ('max_yearly', 'max_monthly');

insert into plans (
  key, name, description, price, currency, billing_interval, duration_days,
  sort_order, badge, billing_label, savings_label, monthly_equivalent, features, is_active, audience,
  tier, limits, includes, free_emails_month
)
select p.key || '_regular', p.name, p.description,
       r.price, p.currency, p.billing_interval, p.duration_days,
       p.sort_order, p.badge, p.billing_label, r.savings, r.monthly, p.features, true, 'outsider',
       p.tier, p.limits, p.includes, p.free_emails_month
  from plans p
  join (values
    ('starter_yearly',  35988::numeric, 2999::numeric, 'Save ₹12,000'),
    ('starter_monthly',  3999::numeric, 3999::numeric, null),
    ('pro_yearly',      59988::numeric, 4999::numeric, 'Save ₹12,000'),
    ('pro_monthly',      5999::numeric, 5999::numeric, null),
    ('max_yearly',      95988::numeric, 7999::numeric, 'Save ₹24,000'),
    ('max_monthly',      9999::numeric, 9999::numeric, null)
  ) as r(key, price, monthly, savings) on r.key = p.key
on conflict (key) do update set
  price = excluded.price, monthly_equivalent = excluded.monthly_equivalent,
  savings_label = excluded.savings_label, features = excluded.features,
  limits = excluded.limits, includes = excluded.includes,
  audience = 'outsider', is_active = true, updated_at = now();

-- ── where the member list lives ──────────────────────────────────────
alter table platform_settings
  add column if not exists diamond_sheet_url       text,
  add column if not exists diamond_sheet_synced_at timestamptz,
  add column if not exists diamond_sheet_rows      int,
  add column if not exists diamond_sheet_error     text;

update platform_settings set support_whatsapp = '919109192065', updated_at = now();

-- The numbers copied from the sheet: the last ten digits of each, and the
-- name beside it when the sheet has one. Replaced whole on every copy.
create table if not exists diamond_roster (
  phone     text primary key check (phone ~ '^[0-9]{10}$'),
  name      text,
  synced_at timestamptz not null default now()
);
alter table diamond_roster enable row level security;
revoke all on diamond_roster from public, anon, authenticated;
grant all on diamond_roster to service_role;

-- The number that made a studio Diamond: one studio per number.
alter table companies add column if not exists diamond_phone text;
create unique index if not exists companies_diamond_phone_key
  on companies (diamond_phone) where diamond_phone is not null;

/*
 * An owner's registered mobile number, checked against the member list.
 * Called by the API as the service after it has checked the caller owns the
 * studio. Answers 'verified', 'already', 'not_found', 'taken' (the number
 * opened another studio) or 'too_many' (ten tries in a day).
 */
create or replace function diamond_verify_phone(p_company uuid, p_phone text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone  text;
  v_tries  int;
begin
  if exists (select 1 from companies where id = p_company and member_tier = 'diamond') then
    return 'already';
  end if;
  select count(*) into v_tries from billing_events
   where company_id = p_company and kind = 'diamond_phone_try' and created_at > now() - interval '1 day';
  if v_tries >= 10 then
    return 'too_many';
  end if;
  insert into billing_events (company_id, kind, detail)
    values (p_company, 'diamond_phone_try', '{}'::jsonb);

  if length(v_digits) < 10 then
    return 'not_found';
  end if;
  v_phone := right(v_digits, 10);
  if not exists (select 1 from diamond_roster where phone = v_phone) then
    return 'not_found';
  end if;
  if exists (select 1 from companies where diamond_phone = v_phone and id <> p_company) then
    return 'taken';
  end if;

  update companies c
     set member_tier = 'diamond',
         diamond_verified_at = now(),
         diamond_phone = v_phone,
         grandfathered_until = case
           when coalesce(c.plan_expiry, 'epoch'::timestamptz) > now() then c.grandfathered_until
           else greatest(coalesce(c.grandfathered_until, now()), c.created_at + interval '30 days')
         end
   where c.id = p_company;
  insert into billing_events (company_id, kind, detail)
    values (p_company, 'diamond_verified_phone', jsonb_build_object('phone_last4', right(v_phone, 4)));
  return 'verified';
end;
$$;
revoke all on function diamond_verify_phone(uuid, text) from public, anon, authenticated;
grant execute on function diamond_verify_phone(uuid, text) to service_role;

-- Take Diamond away: copied from 0214, and the number is let go too, so the
-- right studio can use it.
create or replace function platform_diamond_revoke(p_company uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  update companies c
     set member_tier = 'outsider',
         diamond_verified_at = null,
         diamond_phone = null,
         grandfathered_until = case
           when c.grandfathered_until is null then null
           else least(c.grandfathered_until, c.created_at + interval '7 days')
         end
   where c.id = p_company;
  if not found then
    raise exception 'unknown studio' using errcode = '42501';
  end if;
  update diamond_claims
     set status = 'revoked', decided_by = auth.uid()::text, decided_at = now(),
         reason = nullif(btrim(coalesce(p_reason, '')), '')
   where company_id = p_company and status = 'approved';
  insert into billing_events (company_id, kind, detail)
    values (p_company, 'diamond_revoked', jsonb_build_object('by', auth.uid(), 'reason', p_reason));
end;
$$;
revoke all on function platform_diamond_revoke(uuid, text) from public, anon;
grant execute on function platform_diamond_revoke(uuid, text) to authenticated;
