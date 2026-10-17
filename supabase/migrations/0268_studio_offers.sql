-- 0268: what each studio is doing, and a personal offer from the platform
-- owner (owner, 17 Oct: "see how many studios are actively using it ... bulk
-- select some studios ... set the discount ... and show it to them").
--
--   * platform_studio_activity(): per studio, what it has made (projects,
--     invoices, leads, shoots, team) and how often it opens the app (days
--     with any use in the last 7 and 30, India dates; last time seen). The
--     platform admin reads counts only, never what is inside them.
--   * studio_offers: one live offer per studio -- a percent off the first
--     plan it buys, on the plans picked, until the end of a day. The owner's
--     rules (17 Oct): an offer is for a studio's FIRST payment only, never a
--     renewal, so a studio that has bought before is skipped; it is for the
--     regular price unless the offer says Diamond members too, so a Diamond
--     studio is skipped otherwise. Making a new offer for a studio ends its
--     old one.
--   * The studio sees it on Home and Plan & billing (my_offer()); seeing it
--     and pressing Talk to us on WhatsApp are marked once (offer_mark()), and
--     giving that studio a plan in Studio Access Manager marks it used
--     (platform_offer_used()), so each offer reads sent → seen → asked → paid.
--   * Nothing here charges anything or touches create_payment_order: buying
--     is still a WhatsApp conversation, and the platform owner gives the plan
--     at the offer price.

-- ── what each studio is doing ────────────────────────────────────────
create or replace function platform_studio_activity()
returns table (
  company_id     uuid,
  projects       int,
  invoices       int,
  leads          int,
  shoots         int,
  team           int,
  active_days_7  int,
  active_days_30 int,
  last_active    timestamptz,
  last_made      timestamptz,
  bought         boolean
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
    with p as (select x.company_id, count(*)::int n, max(x.created_at) last from projects x group by 1),
         i as (select x.company_id, count(*)::int n, max(x.created_at) last from invoices x group by 1),
         l as (select x.company_id, count(*)::int n from crm_leads x group by 1),
         s as (select x.company_id, count(*)::int n from shoots x group by 1),
         t as (select u.company_id, count(*)::int n
                 from users u join companies c on c.id = u.company_id
                where u.deleted_at is null and u.status <> 'inactive'
                  and u.user_id is distinct from c.owner_user_id
                group by 1),
         a as (select e.company_id,
                      (count(distinct (e.occurred_at at time zone 'Asia/Kolkata')::date)
                         filter (where e.occurred_at > now() - interval '7 days'))::int d7,
                      count(distinct (e.occurred_at at time zone 'Asia/Kolkata')::date)::int d30,
                      max(e.occurred_at) last
                 from usage_events e
                where e.occurred_at > now() - interval '30 days'
                group by 1),
         b as (select cs.company_id from company_subscriptions cs
               union
               select po.company_id from payment_orders po where po.status = 'paid')
    select c.id,
           coalesce(p.n, 0), coalesce(i.n, 0), coalesce(l.n, 0), coalesce(s.n, 0), coalesce(t.n, 0),
           coalesce(a.d7, 0), coalesce(a.d30, 0),
           a.last,
           greatest(p.last, i.last),
           exists (select 1 from b where b.company_id = c.id)
      from companies c
      left join p on p.company_id = c.id
      left join i on i.company_id = c.id
      left join l on l.company_id = c.id
      left join s on s.company_id = c.id
      left join t on t.company_id = c.id
      left join a on a.company_id = c.id;
end;
$$;
revoke all on function platform_studio_activity() from public, anon;
grant execute on function platform_studio_activity() to authenticated;

-- ── the offers ───────────────────────────────────────────────────────
create table if not exists studio_offers (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,
  percent      int not null check (percent between 1 and 90),
  tiers        text[] not null default '{starter,pro,max}'
                 check (tiers <@ array['starter', 'pro', 'max'] and cardinality(tiers) > 0),
  for_diamond  boolean not null default false,
  ends_at      timestamptz not null,
  note         text check (note is null or char_length(note) <= 200),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  seen_at      timestamptz,
  asked_at     timestamptz,
  used_at      timestamptz,
  used_plan    text,
  cancelled_at timestamptz
);
create index if not exists studio_offers_company_idx on studio_offers (company_id, created_at desc);
alter table studio_offers enable row level security;
revoke all on studio_offers from public, anon, authenticated;
grant all on studio_offers to service_role;

-- A studio has bought before: a plan given or paid for. Offers are for the first payment only.
create or replace function studio_has_bought(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from company_subscriptions where company_id = p_company)
      or exists (select 1 from payment_orders where company_id = p_company and status = 'paid')
$$;
revoke all on function studio_has_bought(uuid) from public, anon, authenticated;

-- Make one offer for each studio picked. Returns how many were made and,
-- for the rest, why not -- in words the owner reads in a toast.
create or replace function platform_make_offers(
  p_companies uuid[],
  p_percent   int,
  p_tiers     text[],
  p_until     date,
  p_note      text,
  p_diamond   boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ends    timestamptz;
  v_made    int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_c       companies;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  if p_percent is null or p_percent < 1 or p_percent > 90 then
    raise exception 'pick a discount from 1 to 90 percent' using errcode = '22023';
  end if;
  if p_until is null or p_until < (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'pick today or a later date' using errcode = '22023';
  end if;
  if p_tiers is null or cardinality(p_tiers) = 0 or not (p_tiers <@ array['starter', 'pro', 'max']) then
    raise exception 'pick at least one plan' using errcode = '22023';
  end if;
  -- The end of that day in India.
  v_ends := (p_until + 1)::timestamp at time zone 'Asia/Kolkata';

  for v_c in select * from companies where id = any (coalesce(p_companies, '{}')) loop
    if studio_has_bought(v_c.id) then
      v_skipped := v_skipped || jsonb_build_object('company_id', v_c.id, 'name', v_c.name, 'reason', 'has bought a plan before');
    elsif v_c.member_tier = 'diamond' and not coalesce(p_diamond, false) then
      v_skipped := v_skipped || jsonb_build_object('company_id', v_c.id, 'name', v_c.name, 'reason', 'IPC Diamond member');
    else
      update studio_offers set cancelled_at = now()
       where company_id = v_c.id and cancelled_at is null and used_at is null and ends_at > now();
      insert into studio_offers (company_id, percent, tiers, for_diamond, ends_at, note, created_by)
        values (v_c.id, p_percent, p_tiers, coalesce(p_diamond, false), v_ends, nullif(btrim(p_note), ''), auth.uid());
      v_made := v_made + 1;
    end if;
  end loop;
  return jsonb_build_object('made', v_made, 'skipped', v_skipped);
end;
$$;
revoke all on function platform_make_offers(uuid[], int, text[], date, text, boolean) from public, anon;
grant execute on function platform_make_offers(uuid[], int, text[], date, text, boolean) to authenticated;

-- Every offer, newest first, with where it stands.
create or replace function platform_list_offers()
returns table (
  id uuid, company_id uuid, studio text, percent int, tiers text[], for_diamond boolean,
  ends_at timestamptz, note text, created_at timestamptz,
  seen_at timestamptz, asked_at timestamptz, used_at timestamptz, used_plan text, cancelled_at timestamptz
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
    select o.id, o.company_id, c.name, o.percent, o.tiers, o.for_diamond, o.ends_at, o.note, o.created_at,
           o.seen_at, o.asked_at, o.used_at, o.used_plan, o.cancelled_at
      from studio_offers o join companies c on c.id = o.company_id
     order by o.created_at desc
     limit 500;
end;
$$;
revoke all on function platform_list_offers() from public, anon;
grant execute on function platform_list_offers() to authenticated;

create or replace function platform_cancel_offer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  update studio_offers set cancelled_at = now()
   where id = p_id and cancelled_at is null and used_at is null;
end;
$$;
revoke all on function platform_cancel_offer(uuid) from public, anon;
grant execute on function platform_cancel_offer(uuid) to authenticated;

-- A plan given in Studio Access Manager uses the studio's live offer when the
-- plan is one the offer covers.
create or replace function platform_offer_used(p_company uuid, p_plan_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  update studio_offers o
     set used_at = now(), used_plan = p_plan_key
   where o.company_id = p_company
     and o.cancelled_at is null and o.used_at is null and o.ends_at > now()
     and (select p.tier from plans p where p.key = p_plan_key) = any (o.tiers);
end;
$$;
revoke all on function platform_offer_used(uuid, text) from public, anon;
grant execute on function platform_offer_used(uuid, text) to authenticated;

-- ── what the studio sees ─────────────────────────────────────────────
-- The live offer for the caller's studio, or nothing. An offer stops showing
-- the moment it ends, is used or cancelled, or the studio has bought.
create or replace function my_offer()
returns table (id uuid, percent int, tiers text[], for_diamond boolean, ends_at timestamptz, note text)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.percent, o.tiers, o.for_diamond, o.ends_at, o.note
    from studio_offers o
   where o.company_id = get_current_company_id()
     and o.cancelled_at is null and o.used_at is null and o.ends_at > now()
     and not studio_has_bought(o.company_id)
   order by o.created_at desc
   limit 1
$$;
revoke all on function my_offer() from public, anon;
grant execute on function my_offer() to authenticated;

-- Seen (it was on screen) or asked (Talk to us on WhatsApp was pressed), once each.
create or replace function offer_mark(p_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('seen', 'asked') then
    raise exception 'unknown mark' using errcode = '22023';
  end if;
  update studio_offers
     set seen_at = coalesce(seen_at, now()),
         asked_at = case when p_kind = 'asked' then coalesce(asked_at, now()) else asked_at end
   where id = p_id and company_id = get_current_company_id();
end;
$$;
revoke all on function offer_mark(uuid, text) from public, anon;
grant execute on function offer_mark(uuid, text) to authenticated;
