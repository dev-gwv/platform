-- 0237: Refer a studio. A studio's own referral code, the studios it brought
-- in, and what each earns. Reward, discount and hold values are set by the
-- platform admin later; nothing here pays out on its own.
--
--   * companies.studio_ref_code: the studio's code, made the first time it is
--     asked for (my_studio_ref_code()), never changed after.
--   * studio_referrals: one row per studio that signed up with a code. Written
--     only by the API as the service (claim_studio_referral at sign-up), never
--     by a studio. A studio cannot refer itself, and a studio is referred once.
--   * "Paid" is read, not stored: the referred studio's first paid
--     payment_orders row. Nothing in the payment path changes.
--   * platform_settings carries the terms -- reward per studio, the new
--     studio's discount, and the hold before a reward is due. All null until
--     the owner decides; the screens say "being finalised" while they are.
--   * my_studio_referrals() is the referrer's own list: the referred studio's
--     name, when it joined and when it first paid -- never its money or people.

alter table companies add column if not exists studio_ref_code text unique
  check (studio_ref_code is null or studio_ref_code ~ '^[A-Z0-9]{6,12}$');

alter table platform_settings
  add column if not exists studio_ref_reward numeric(12, 2) check (studio_ref_reward is null or studio_ref_reward >= 0),
  add column if not exists studio_ref_discount_pct numeric(5, 2)
    check (studio_ref_discount_pct is null or (studio_ref_discount_pct >= 0 and studio_ref_discount_pct <= 100)),
  add column if not exists studio_ref_hold_days int check (studio_ref_hold_days is null or studio_ref_hold_days between 0 and 365);

create table if not exists studio_referrals (
  id                  uuid primary key default gen_random_uuid(),
  referrer_company_id uuid not null references companies (id) on delete cascade,
  referred_company_id uuid not null unique references companies (id) on delete cascade,
  code                text not null,
  signed_up_at        timestamptz not null default now(),
  reward_amount       numeric(12, 2) check (reward_amount is null or reward_amount >= 0),
  rewarded_at         timestamptz,
  void_reason         text,
  created_at          timestamptz not null default now(),
  check (referrer_company_id <> referred_company_id)
);
create index if not exists studio_referrals_referrer_idx on studio_referrals (referrer_company_id, signed_up_at desc);

alter table studio_referrals enable row level security;
revoke all on studio_referrals from public, anon, authenticated;
grant select, insert, update, delete on studio_referrals to service_role;

-- ── the caller's code, made on first ask ──────────────────────────────
create or replace function my_studio_ref_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_code text;
begin
  if v_company is null then
    raise exception 'no studio' using errcode = '42501';
  end if;
  select studio_ref_code into v_code from companies where id = v_company;
  while v_code is null loop
    -- Hex: no O, I or L to misread on a phone.
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    if exists (select 1 from companies where studio_ref_code = v_code) then
      v_code := null;
    else
      update companies set studio_ref_code = v_code where id = v_company and studio_ref_code is null;
      select studio_ref_code into v_code from companies where id = v_company;
    end if;
  end loop;
  return v_code;
end;
$$;
revoke all on function my_studio_ref_code() from public, anon;
grant execute on function my_studio_ref_code() to authenticated;

-- ── at sign-up: link the new studio to the one whose code it came with ──
-- Called by the API as the service. A wrong, own or second code is ignored
-- (returns false); sign-up never fails because of it.
create or replace function claim_studio_referral(p_new_company uuid, p_code text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_referrer uuid;
begin
  if v_code !~ '^[A-Z0-9]{6,12}$' then
    return false;
  end if;
  select id into v_referrer from companies where studio_ref_code = v_code;
  if v_referrer is null or v_referrer = p_new_company then
    return false;
  end if;
  insert into studio_referrals (referrer_company_id, referred_company_id, code)
  values (v_referrer, p_new_company, v_code)
  on conflict (referred_company_id) do nothing;
  return found;
end;
$$;
revoke all on function claim_studio_referral(uuid, text) from public, anon, authenticated;
grant execute on function claim_studio_referral(uuid, text) to service_role;

-- ── the referrer's own list ───────────────────────────────────────────
create or replace function my_studio_referrals()
returns table (id uuid, studio_name text, signed_up_at timestamptz, paid_at timestamptz,
               reward_amount numeric, rewarded_at timestamptz, void_reason text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         coalesce(nullif(btrim(co.display_name), ''), co.name),
         r.signed_up_at,
         (select min(o.created_at) from payment_orders o where o.company_id = r.referred_company_id and o.status = 'paid'),
         r.reward_amount, r.rewarded_at, r.void_reason
    from studio_referrals r
    join companies co on co.id = r.referred_company_id
   where r.referrer_company_id = get_current_company_id()
   order by r.signed_up_at desc
$$;
revoke all on function my_studio_referrals() from public, anon;
grant execute on function my_studio_referrals() to authenticated;
