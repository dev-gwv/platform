-- 0214: two audiences. IPC Diamond members get a 30-day trial and the member
-- prices; everyone else gets 7 days and one plan, Rs 1,00,000 + GST a year.
--
-- The owner: "I do not want to show a 30-day free trial to everyone." A studio
-- proves it is a Diamond member by uploading a screenshot of the "IPC Diamonds
-- - Premium" WhatsApp group. The API has Claude read the group title and, when
-- it matches, approves the claim at once (diamond_decide, decided_by 'auto').
-- Every claim lands in the platform inbox with the screenshot, where the owner
-- can approve, reject, or revoke an approval (platform_diamond_*).
--
-- What changes for whom:
--   * a new studio gets 7 days (the column default; was 30 in 0210);
--   * studios already inside keep the dates they have (no backfill of days);
--   * studios that have paid, or that a platform admin owns, are Diamond
--     already: they signed up at member prices and must be able to renew;
--   * plans carry an audience; /subscription/plans shows a studio only its
--     own, and create_payment_order refuses the other audience's plan.

-- ── who a studio is ────────────────────────────────────────────────────
alter table companies
  add column if not exists member_tier text not null default 'outsider'
    check (member_tier in ('outsider', 'diamond')),
  add column if not exists diamond_verified_at timestamptz;

alter table companies alter column grandfathered_until set default now() + interval '7 days';

update companies c
   set member_tier = 'diamond', diamond_verified_at = coalesce(c.diamond_verified_at, now())
 where c.member_tier = 'outsider'
   and (c.plan_expiry is not null
        or exists (select 1 from payment_orders o where o.company_id = c.id and o.status = 'paid')
        or exists (select 1 from platform_admins a where a.user_id = c.owner_user_id));

-- ── plans for each audience ────────────────────────────────────────────
alter table plans
  add column if not exists audience text not null default 'diamond'
    check (audience in ('diamond', 'outsider'));

insert into plans (
  key, name, description, price, currency, billing_interval, duration_days,
  sort_order, badge, billing_label, savings_label, monthly_equivalent, features, is_active, audience
)
values
  ('studio_yearly', 'Yearly', 'Everything in Studio AutoPilot for one year.',
   100000, 'INR', 'yearly', 365, 90,
   null, 'Billed yearly', null, null,
   jsonb_build_array(
     'All Studio modules included',
     'Unlimited projects, shoots & team',
     'Email & in-app support'
   ), true, 'outsider')
on conflict (key) do update set
  name = excluded.name, description = excluded.description, price = excluded.price,
  billing_interval = excluded.billing_interval, duration_days = excluded.duration_days,
  sort_order = excluded.sort_order, billing_label = excluded.billing_label,
  features = excluded.features, is_active = excluded.is_active, audience = excluded.audience,
  updated_at = now();

-- ── the claims ─────────────────────────────────────────────────────────
create table if not exists diamond_claims (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,
  submitted_by uuid references auth.users (id) on delete set null,
  file_id      uuid references files (id) on delete set null,
  status       text not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected', 'revoked')),
  -- 'auto' when Claude decided; the platform admin's user id when a person did.
  decided_by   text,
  decided_at   timestamptz,
  reason       text check (reason is null or char_length(reason) <= 500),
  -- What was read off the screenshot: group title, whether it looked like a
  -- WhatsApp group chat, how sure. Kept so a decision can be explained.
  reading      jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists diamond_claims_company_idx on diamond_claims (company_id, created_at desc);
create unique index if not exists diamond_claims_one_pending
  on diamond_claims (company_id) where status = 'pending';

alter table diamond_claims enable row level security;
drop policy if exists diamond_claims_select on diamond_claims;
create policy diamond_claims_select on diamond_claims for select to authenticated
  using (company_id = get_current_company_id());
grant select on diamond_claims to authenticated;

-- ── submit: the owner sends a screenshot ───────────────────────────────
create or replace function diamond_submit_claim(p_file uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id      uuid;
begin
  if v_company is null or not is_current_owner() then
    raise exception 'only the studio owner can do this' using errcode = '42501';
  end if;
  if not exists (
    select 1 from files f
     where f.id = p_file and f.company_id = v_company
       and f.mime in ('image/png', 'image/jpeg', 'image/webp')
  ) then
    raise exception 'upload a screenshot image first' using errcode = '22023';
  end if;
  if exists (select 1 from companies where id = v_company and member_tier = 'diamond') then
    raise exception 'already verified' using errcode = '22023';
  end if;
  -- A second try replaces a pending one rather than queueing behind it.
  update diamond_claims set status = 'rejected', decided_by = 'superseded', decided_at = now()
   where company_id = v_company and status = 'pending';
  insert into diamond_claims (company_id, submitted_by, file_id)
    values (v_company, auth.uid(), p_file)
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function diamond_submit_claim(uuid) from public, anon;
grant execute on function diamond_submit_claim(uuid) to authenticated;

-- ── decide: approve or reject a pending claim ──────────────────────────
-- Called by the API after the automatic check (service role), and by
-- platform_diamond_decide when the owner decides by hand. Approving makes the
-- studio Diamond and stretches an unpaid trial to 30 days from sign-up.
create or replace function diamond_decide(
  p_claim   uuid,
  p_approve boolean,
  p_by      text,
  p_reason  text,
  p_reading jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim diamond_claims;
begin
  select * into v_claim from diamond_claims where id = p_claim for update;
  if not found then
    raise exception 'unknown claim' using errcode = '42501';
  end if;
  if v_claim.status not in ('pending', 'rejected') then
    return v_claim.status;
  end if;

  update diamond_claims
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = p_by, decided_at = now(),
         reason = nullif(btrim(coalesce(p_reason, '')), ''),
         reading = coalesce(p_reading, reading)
   where id = p_claim;

  if p_approve then
    update companies c
       set member_tier = 'diamond',
           diamond_verified_at = now(),
           grandfathered_until = case
             when coalesce(c.plan_expiry, 'epoch'::timestamptz) > now() then c.grandfathered_until
             else greatest(coalesce(c.grandfathered_until, now()), c.created_at + interval '30 days')
           end
     where c.id = v_claim.company_id;
  end if;

  insert into billing_events (company_id, kind, detail)
    values (v_claim.company_id,
            case when p_approve then 'diamond_approved' else 'diamond_rejected' end,
            jsonb_build_object('claim', p_claim, 'by', p_by, 'reason', p_reason));
  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;
revoke all on function diamond_decide(uuid, boolean, text, text, jsonb) from public, anon, authenticated;
grant execute on function diamond_decide(uuid, boolean, text, text, jsonb) to service_role;

-- ── the platform inbox ─────────────────────────────────────────────────
create or replace function platform_list_diamond_claims(p_status text default null)
returns table (
  id uuid, company_id uuid, company_name text, member_tier text, owner_email text,
  file_id uuid, status text, decided_by text, decided_at timestamptz, reason text,
  reading jsonb, created_at timestamptz, access_until timestamptz
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
    select d.id, d.company_id, c.name, c.member_tier, o.email,
           d.file_id, d.status, d.decided_by, d.decided_at, d.reason,
           d.reading, d.created_at,
           company_access_until(c.plan_expiry, c.grandfathered_until, c.grace_until)
      from diamond_claims d
      join companies c on c.id = d.company_id
      left join users o on o.user_id = c.owner_user_id
     where (p_status is null or d.status = p_status)
       and d.decided_by is distinct from 'superseded'
     order by d.created_at desc
     limit 500;
end;
$$;
revoke all on function platform_list_diamond_claims(text) from public, anon;
grant execute on function platform_list_diamond_claims(text) to authenticated;

create or replace function platform_diamond_decide(p_claim uuid, p_approve boolean, p_reason text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  return diamond_decide(p_claim, p_approve, auth.uid()::text, p_reason, null);
end;
$$;
revoke all on function platform_diamond_decide(uuid, boolean, text) from public, anon;
grant execute on function platform_diamond_decide(uuid, boolean, text) to authenticated;

-- Take Diamond away: back to an outsider's 7 days (from sign-up) and price.
-- A plan the studio has paid for is left alone.
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

create or replace function platform_diamond_claim_file(p_claim uuid)
returns table (name text, mime text, bytes bytea)
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
    select f.name, f.mime, f.bytes
      from diamond_claims d join files f on f.id = d.file_id
     where d.id = p_claim;
end;
$$;
revoke all on function platform_diamond_claim_file(uuid) from public, anon;
grant execute on function platform_diamond_claim_file(uuid) to authenticated;

-- ── checkout sells a studio only its own audience's plans ──────────────
-- Copied from 0016 (the only definition) with the audience check added.
create or replace function create_payment_order(p_plan_id uuid)
returns table (order_id uuid, amount numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_price   numeric;
  v_amount  numeric;
  v_id      uuid;
begin
  if not is_current_owner() then
    raise exception 'only the owner can start a subscription' using errcode = '42501';
  end if;
  select p.price into v_price
    from plans p
    join companies c on c.id = v_company
   where p.id = p_plan_id and p.is_active and p.audience = c.member_tier;
  if v_price is null then
    raise exception 'unknown plan' using errcode = '42501';
  end if;
  v_amount := round(v_price * 1.18, 2);  -- +18% GST (kept from the original)
  insert into payment_orders (company_id, plan_id, amount, created_by)
    values (v_company, p_plan_id, v_amount, auth.uid())
    returning id into v_id;
  return query select v_id, v_amount;
end;
$$;

-- ── the studios list shows who is a member ─────────────────────────────
-- Copied from 0210 with member_tier added; the return type changes.
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
  access_until  timestamptz,
  member_tier   text
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
      company_access_until(c.plan_expiry, c.grandfathered_until, c.grace_until),
      c.member_tier
    from companies c
    left join users owner on owner.user_id = c.owner_user_id
    order by c.created_at desc;
end;
$$;
revoke all on function platform_list_studios() from public, anon;
grant execute on function platform_list_studios() to authenticated;
