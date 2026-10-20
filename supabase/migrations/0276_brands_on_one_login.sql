-- 0276: brands on one login, and partners see their leads' details.
--
-- Brands (owner, 20 Oct). A studio owner on Pro runs up to three brands
-- (studios) from one login, a maternity brand beside the wedding one, say;
-- Studio Max as many as they like; Starter, Diamond or regular, has its one.
-- A brand is a studio of its own (its own leads, projects, team, money),
-- made the way 0159 makes a second studio for a login: a profile row of the
-- same identity owns it, so it opens from the account menu's studio switch
-- like any other. It rides on the first studio's plan: `brand_of` points at
-- that studio, the plan, its expiry and plan year are copied when the brand
-- is made and kept in step whenever the first studio's plan changes. The
-- count is per first studio, so a brand cannot open brands of its own.
--
-- Partners (owner, 20 Oct). A partner's page (/enquiry-view/<token>) showed
-- numbers as 98xxxxx123 unless the studio switched them on; the owner wants
-- partners to see each lead's real details. Full contact details are now on
-- by default, for every partner, and carry the email too. The switch on the
-- partner's page in the studio still hides them for a partner who should not
-- have them.
--
-- Safe to run twice.

-- ── brands ──────────────────────────────────────────────────────────
alter table companies add column if not exists brand_of uuid references companies (id) on delete set null;
create index if not exists companies_brand_of_idx on companies (brand_of) where brand_of is not null;

-- The plan rows say it, so Compare plans and the Subscription page read it
-- from the same place as every other limit.
update plans set limits = coalesce(limits, '{}'::jsonb) || '{"brands": 1}'::jsonb where tier = 'starter';
update plans set limits = coalesce(limits, '{}'::jsonb) || '{"brands": 3}'::jsonb where tier = 'pro';
update plans set limits = coalesce(limits, '{}'::jsonb) - 'brands' where tier = 'max';

/** The studio whose plan a brand rides on: itself, unless it is a brand. */
create or replace function brand_root(p_company uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select brand_of from companies where id = p_company), p_company)
$$;
revoke all on function brand_root(uuid) from public, anon;
grant execute on function brand_root(uuid) to authenticated, service_role;

/**
 * How many studios (the first one included) the plan allows; null is no
 * limit. No live plan, a trial included, is one: brands are a Pro feature.
 */
create or replace function brand_limit(p_company uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan plans;
begin
  v_plan := company_plan(brand_root(p_company));
  if v_plan.key is null then
    return 1;
  end if;
  if v_plan.limits ? 'brands' then
    return nullif(v_plan.limits ->> 'brands', '')::int;
  end if;
  return case v_plan.tier when 'max' then null when 'pro' then 3 else 1 end;
end;
$$;
revoke all on function brand_limit(uuid) from public, anon;
grant execute on function brand_limit(uuid) to authenticated, service_role;

/** The caller's brands: how many there are, how many the plan allows, and whether they may add one. */
create or replace function my_brands()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_company uuid := get_current_company_id();
  v_root    uuid;
  v_used    int;
  v_limit   int;
  v_owner   boolean;
  v_plan    plans;
begin
  if v_uid is null or v_company is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_root := brand_root(v_company);
  select count(*) into v_used from companies where id = v_root or brand_of = v_root;
  v_limit := brand_limit(v_root);
  v_owner := exists (select 1 from companies where id = v_company and owner_user_id = v_uid)
             and auth_identity_of((select owner_user_id from companies where id = v_root)) = auth_identity_of(v_uid);
  v_plan := company_plan(v_root);
  return jsonb_build_object(
    'used', v_used,
    'limit', v_limit,
    'is_owner', v_owner,
    'can_add', v_owner and (v_limit is null or v_used < v_limit),
    'plan_name', v_plan.name,
    'plan_tier', v_plan.tier
  );
end;
$$;
revoke all on function my_brands() from public, anon;
grant execute on function my_brands() to authenticated;

/**
 * A new brand for the caller's login: a studio named p_name, owned by a new
 * profile of the same identity, on the first studio's plan. Returns the
 * profile id, which the app switches to.
 */
create or replace function create_brand(p_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_company  uuid := get_current_company_id();
  v_root     companies;
  v_identity uuid;
  v_name     text := trim(coalesce(p_name, ''));
  v_used     int;
  v_limit    int;
  v_plan     plans;
  v_me       users;
  v_profile  uuid;
  v_new      uuid;
begin
  if v_uid is null or v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from companies where id = v_company and owner_user_id = v_uid) then
    raise exception 'Only the owner can add a brand.' using errcode = '42501';
  end if;
  select * into v_root from companies where id = brand_root(v_company);
  v_identity := auth_identity_of(v_uid);
  if auth_identity_of(v_root.owner_user_id) is distinct from v_identity then
    raise exception 'Only the owner can add a brand.' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'Give the brand a name of 2 to 80 letters.' using errcode = '22023';
  end if;

  select count(*) into v_used from companies where id = v_root.id or brand_of = v_root.id;
  v_limit := brand_limit(v_root.id);
  if v_limit is not null and v_used >= v_limit then
    v_plan := company_plan(v_root.id);
    if v_limit <= 1 then
      raise exception 'More than one brand comes with the Pro and Studio Max plans. Upgrade to add a brand.'
        using errcode = '54000';
    end if;
    raise exception 'Your % plan has % brands. Studio Max has as many as you need.', v_plan.name, v_limit
      using errcode = '54000';
  end if;

  select * into v_me from users where user_id = v_uid;

  insert into auth.users (email, encrypted_password, email_verified, email_verified_at, identity_id)
  values (null, null, true, now(), v_identity)
  returning id into v_profile;

  insert into companies (name, owner_user_id, display_name, brand_of, plan, plan_expiry, plan_period_start)
  values (v_name, v_profile, v_name, v_root.id, v_root.plan, v_root.plan_expiry, v_root.plan_period_start)
  returning id into v_new;

  insert into users (user_id, company_id, role, name, email, phone, status, login_enabled)
  values (v_profile, v_new, 'super_admin', coalesce(v_me.name, 'Owner'), coalesce(v_me.email, ''), v_me.phone, 'active', true);

  return v_profile;
end;
$$;
revoke all on function create_brand(text) from public, anon;
grant execute on function create_brand(text) to authenticated;

/** A brand's plan follows its first studio's: renewed, upgraded or ended together. */
create or replace function brands_follow_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.brand_of is null then
    update companies
       set plan = new.plan, plan_expiry = new.plan_expiry, plan_period_start = new.plan_period_start
     where brand_of = new.id
       and (plan, plan_expiry, plan_period_start) is distinct from (new.plan, new.plan_expiry, new.plan_period_start);
  end if;
  return new;
end;
$$;
drop trigger if exists companies_brands_follow_plan on companies;
create trigger companies_brands_follow_plan after update of plan, plan_expiry, plan_period_start on companies
  for each row execute function brands_follow_plan();

-- ── partners see their leads' details ───────────────────────────────
alter table enquiry_partners alter column show_phone set default true;
update enquiry_partners set show_phone = true where not show_phone;

-- Copied from 0274 with the email and city beside the number.
create or replace function enquiry_partner_page(p_raw text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_p   enquiry_partners;
  v_out jsonb;
begin
  select * into v_p from enquiry_partners
   where view_token = p_raw and p_raw is not null and archived_at is null;
  if not found then return null; end if;
  update enquiry_partners set page_views = page_views + 1, page_viewed_at = now() where id = v_p.id;

  select jsonb_build_object(
    'studio', c.name,
    'city', c.city,
    'logo_url', c.invoice_logo_url,
    'form_name', v_p.name,
    'scans', v_p.scans,
    'enquiries', (select count(*) from crm_leads where partner_id = v_p.id and merged_into is null),
    'booked', (select count(*) from crm_leads where partner_id = v_p.id and merged_into is null and status = 'converted'),
    'full_details', v_p.show_phone,
    'leads', coalesce((
      select jsonb_agg(x order by x->>'enquired_on' desc)
        from (
          select jsonb_build_object(
                   'name', l.name,
                   'phone', case when v_p.show_phone then l.phone else enquiry_form_mask_phone(l.phone) end,
                   'email', case when v_p.show_phone then l.email end,
                   'city', l.city,
                   'enquired_on', l.created_at,
                   'event_type', l.event_type,
                   'event_date', l.event_date,
                   'status', enquiry_form_status(l.status)) as x
            from crm_leads l
           where l.partner_id = v_p.id and l.merged_into is null
           order by l.created_at desc
           limit 500
        ) t
    ), '[]'::jsonb)
  ) into v_out
  from companies c where c.id = v_p.company_id;
  return v_out;
end;
$$;
revoke all on function enquiry_partner_page(text) from public, anon, authenticated;
grant execute on function enquiry_partner_page(text) to service_role;
