-- 0270: the enquiry form, brought in line with the hand-off spec (Wedding
-- Yantra, 19 Oct; docs/handoff/enquiry-form-qr-whatsapp-spec.md). The owner:
-- "where their version differs from this file, this file wins".
--
--   * One main form per studio (is_main) with a readable link, /f/<slug>.
--     Other website forms (0240) stay as they are.
--   * After sending, the client lands in a WhatsApp chat with the studio, with
--     their details typed in (after_submit whatsapp | thanks | link). The
--     number is the form's own, else the studio's invoice phone, else the
--     owner's. A link must be https:// -- the database holds that rule.
--   * Two more questions: "What do you need?" (the studio's own service list,
--     custom_lookups 'enquiry_service') and the number of guests. A new form
--     asks email, event, date and "Anything else?", as the spec says.
--   * Partners (enquiry_partners): a boutique, jeweller, venue or one of the
--     studio's vendors keeps the studio's QR at their counter -- the main form
--     with ?p=<code>. Each counts its scans, its leads are credited to it
--     (crm_leads.partner_id) and it can be given a private page of them.
--     0195's vendor forms are moved over: each becomes a partner with the same
--     code and page link, so a QR already printed still opens and credits.
--   * The same number again while its lead is still open makes no second
--     lead: a note goes on the open one and whoever has it is told "Enquired
--     again". A new lead tells the owner "New enquiry".
--   * Vendors (parties) can do several kinds of work (categories).
--
-- 0195/0240's enquiry_form_public / enquiry_form_submit / enquiry_form_page
-- are left as they were; the API moves to enquiry_public / enquiry_submit /
-- enquiry_partner_page below.

-- ── the form's new settings ─────────────────────────────────────────
alter table enquiry_forms
  add column if not exists is_main        boolean not null default false,
  add column if not exists slug           text unique check (slug is null or slug ~ '^[a-z0-9-]{4,60}$'),
  add column if not exists after_submit   text not null default 'whatsapp'
    check (after_submit in ('thanks', 'whatsapp', 'link')),
  add column if not exists whatsapp_phone text check (whatsapp_phone is null or whatsapp_phone ~ '^\+[0-9]{10,15}$'),
  add column if not exists whatsapp_text  text check (whatsapp_text is null or char_length(whatsapp_text) <= 300),
  add column if not exists redirect_url   text check (
    redirect_url is null
    or (redirect_url ~ '^https://[^[:space:]<>"]+$' and char_length(redirect_url) <= 500));
create unique index if not exists enquiry_forms_one_main on enquiry_forms (company_id) where is_main;

-- "Link" needs the link.
alter table enquiry_forms drop constraint if exists enquiry_forms_link_check;
alter table enquiry_forms add constraint enquiry_forms_link_check
  check (after_submit <> 'link' or redirect_url is not null);

grant update (after_submit, whatsapp_phone, whatsapp_text, redirect_url) on enquiry_forms to authenticated;

-- Eight questions besides name and mobile, each off, optional or required.
create or replace function enquiry_fields_ok(p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each_text(p) e
        where e.key not in ('email', 'event_type', 'event_date', 'city', 'services', 'guests', 'budget', 'message')
           or e.value not in ('off', 'optional', 'required'))
$$;
alter table enquiry_forms alter column fields set default
  '{"email":"optional","event_type":"optional","event_date":"optional","city":"off","services":"off","guests":"off","budget":"off","message":"optional"}'::jsonb;

-- ── what the form offers ────────────────────────────────────────────
/** "What do you need?": the studio's own list, or a photo studio's usual one. */
create or replace function enquiry_services(p_company uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select array_agg(value order by sort_order, value)
       from custom_lookups
      where company_id = p_company and category = 'enquiry_service' and is_active),
    array['Photography', 'Cinematography', 'Pre-wedding shoot', 'Drone', 'Album', 'Live streaming'])
$$;
revoke all on function enquiry_services(uuid) from public, anon;
grant execute on function enquiry_services(uuid) to authenticated, service_role;

/** The event list: the studio's own (Settings → Lists), else the usual ones. */
create or replace function enquiry_event_types(p_company uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select array_agg(value order by sort_order, value)
       from custom_lookups
      where company_id = p_company and category = 'project_type' and is_active),
    array['Wedding', 'Engagement / Roka', 'Pre-wedding', 'Haldi', 'Mehendi', 'Sangeet', 'Reception',
          'Birthday', 'Anniversary', 'Baby shower', 'Maternity', 'Corporate', 'Other'])
$$;
revoke all on function enquiry_event_types(uuid) from public, anon;
grant execute on function enquiry_event_types(uuid) to authenticated, service_role;

/** The number chats open with, as digits with the country code (919876543210), or null. */
create or replace function enquiry_default_whatsapp(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when length(d) = 10 then '91' || d when length(d) between 11 and 15 then d end
    from (
      select regexp_replace(coalesce(
               nullif(trim(c.invoice_phone), ''),
               (select nullif(trim(u.phone), '') from users u
                 where u.user_id = c.owner_user_id and u.company_id = c.id limit 1),
               ''), '\D', '', 'g') as d
        from companies c where c.id = p_company
    ) x
$$;
revoke all on function enquiry_default_whatsapp(uuid) from public, anon;
grant execute on function enquiry_default_whatsapp(uuid) to authenticated, service_role;

-- ── one main form per studio ────────────────────────────────────────
create or replace function enquiry_new_slug(p_name text)
returns text
language sql
volatile
as $$
  select coalesce(nullif(trim(both '-' from left(trim(both '-' from
           lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]+', '-', 'g'))), 40)), ''), 'studio')
         || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6)
$$;

/**
 * The studio's main form: the one marked, else its oldest open website form
 * (marked now), else a new one. Internal; the callers check who asks.
 */
create or replace function enquiry_main_form_for(p_company uuid)
returns enquiry_forms
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row    enquiry_forms;
  v_alpha  constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_code   text;
  v_source uuid;
  v_name   text;
begin
  select * into v_row from enquiry_forms where company_id = p_company and is_main;
  if found then
    if v_row.slug is null then
      update enquiry_forms set slug = enquiry_new_slug((select name from companies where id = p_company))
       where id = v_row.id returning * into v_row;
    end if;
    return v_row;
  end if;

  select name into v_name from companies where id = p_company;
  select * into v_row from enquiry_forms
   where company_id = p_company and purpose = 'website' and archived_at is null
   order by created_at limit 1;
  if found then
    update enquiry_forms set is_main = true, slug = coalesce(slug, enquiry_new_slug(v_name))
     where id = v_row.id returning * into v_row;
    return v_row;
  end if;

  loop
    select string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1), '')
      into v_code from generate_series(1, 7);
    exit when not exists (select 1 from enquiry_forms where code = v_code)
          and not exists (select 1 from enquiry_partners where code = v_code);
  end loop;
  insert into crm_webhook_sources (company_id, source_key, kind, label, source_type, default_source)
  values (p_company,
          replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
          'webform', 'Enquiry form', 'enquiry_form', 'enquiry')
  returning id into v_source;
  insert into enquiry_forms (company_id, name, code, source_id, purpose, is_main, slug)
  values (p_company, 'Enquiry form', v_code, v_source, 'website', true, enquiry_new_slug(v_name))
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function enquiry_main_form_for(uuid) from public, anon, authenticated;

/** The caller's studio's main form, made on first ask. */
create or replace function enquiry_main_form()
returns enquiry_forms
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return enquiry_main_form_for(v_company);
end;
$$;
revoke all on function enquiry_main_form() from public, anon;
grant execute on function enquiry_main_form() to authenticated;

-- ── partners ────────────────────────────────────────────────────────
create table if not exists enquiry_partners (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies (id) on delete cascade,
  name           text not null check (char_length(trim(name)) between 2 and 80),
  -- Their kinds, ", "-joined: "Boutique, Salon".
  label          text check (label is null or char_length(label) <= 120),
  party_id       uuid references parties (id) on delete set null,
  phone          text check (phone is null or char_length(phone) <= 30),
  notes          text check (notes is null or char_length(notes) <= 1000),
  -- On the QR: the main form with ?p=<code>. Unique everywhere, so an old
  -- vendor form's /enquire/<code> finds its partner too.
  code           text not null unique check (code ~ '^[a-z0-9]{6,12}$'),
  -- Their page, /enquiry-view/<token>. Null = sharing stopped.
  view_token     text unique check (view_token is null or view_token ~ '^[A-Za-z0-9_-]{20,100}$'),
  show_phone     boolean not null default false,
  scans          int not null default 0,
  page_views     int not null default 0,
  page_viewed_at timestamptz,
  -- The 0195 vendor form this partner was moved from, if any.
  from_form_id   uuid references enquiry_forms (id) on delete set null,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz
);
create unique index if not exists enquiry_partners_name_idx on enquiry_partners (company_id, lower(name));
create index if not exists enquiry_partners_party_idx on enquiry_partners (party_id) where party_id is not null;

alter table enquiry_partners enable row level security;
drop policy if exists enquiry_partners_select on enquiry_partners;
create policy enquiry_partners_select on enquiry_partners
  for select to authenticated using (company_id = get_current_company_id());
drop policy if exists enquiry_partners_write on enquiry_partners;
create policy enquiry_partners_write on enquiry_partners
  for update to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());
grant select on enquiry_partners to authenticated;
grant update (name, label, party_id, phone, notes, show_phone, archived_at, view_token) on enquiry_partners to authenticated;
grant all on enquiry_partners to service_role;

create or replace function enquiry_partners_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists enquiry_partners_touch on enquiry_partners;
create trigger enquiry_partners_touch before update on enquiry_partners
  for each row execute function enquiry_partners_touch();

create or replace function enquiry_new_partner_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_alpha constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_code  text;
begin
  loop
    select string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1), '')
      into v_code from generate_series(1, 6);
    exit when not exists (select 1 from enquiry_partners where code = v_code)
          and not exists (select 1 from enquiry_forms where code = v_code);
  end loop;
  return v_code;
end;
$$;
revoke all on function enquiry_new_partner_code() from public, anon, authenticated;

/** A new partner, with its page on from the start (p_token). Errors say which name clashes. */
create or replace function create_enquiry_partner(
  p_name  text,
  p_label text default null,
  p_phone text default null,
  p_party uuid default null,
  p_notes text default null,
  p_token text default null
)
returns enquiry_partners
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_clash   enquiry_partners;
  v_row     enquiry_partners;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Give the partner a name.' using errcode = '22023';
  end if;
  select * into v_clash from enquiry_partners
   where company_id = v_company and lower(name) = lower(trim(p_name));
  if found then
    if v_clash.archived_at is not null then
      raise exception 'An archived partner has this name. Bring them back instead.' using errcode = '23505';
    end if;
    raise exception 'You already have a partner with this name.' using errcode = '23505';
  end if;
  if p_party is not null and not exists (select 1 from parties where id = p_party and company_id = v_company) then
    raise exception 'That vendor was not found.' using errcode = '22023';
  end if;
  perform enquiry_main_form_for(v_company);
  insert into enquiry_partners (company_id, name, label, phone, party_id, notes, code, view_token, created_by)
  values (v_company, trim(p_name), nullif(left(trim(coalesce(p_label, '')), 120), ''),
          nullif(trim(coalesce(p_phone, '')), ''), p_party, nullif(trim(coalesce(p_notes, '')), ''),
          enquiry_new_partner_code(), p_token, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function create_enquiry_partner(text, text, text, uuid, text, text) from public, anon;
grant execute on function create_enquiry_partner(text, text, text, uuid, text, text) to authenticated;

alter table crm_leads add column if not exists partner_id uuid references enquiry_partners (id) on delete set null;
create index if not exists crm_leads_partner_idx on crm_leads (partner_id) where partner_id is not null;

/** Scans, enquiries and booked per partner, for the studio's own screens. */
create or replace view enquiry_partner_stats with (security_invoker = true) as
  select p.id as partner_id,
         count(l.id)::int as enquiries,
         count(l.id) filter (where l.status = 'converted')::int as booked,
         max(l.created_at) as last_enquiry_at
    from enquiry_partners p
    left join crm_leads l on l.partner_id = p.id and l.merged_into is null
   group by p.id;
grant select on enquiry_partner_stats to authenticated;

-- ── vendors with several kinds of work ──────────────────────────────
alter table parties add column if not exists categories text[] not null default '{}';

-- ── 0195's vendor forms become partners ─────────────────────────────
-- Same code (their printed QR keeps working and keeps crediting), same page
-- link, same scans; their leads are marked as theirs. The form itself is
-- archived, which also stops its old lead source.
with v as (
  select f.*,
         row_number() over (partition by f.company_id, lower(trim(f.name)) order by f.created_at) as n
    from enquiry_forms f
   where f.purpose = 'vendor'
     and not exists (select 1 from enquiry_partners p where p.from_form_id = f.id)
)
insert into enquiry_partners (company_id, name, label, phone, notes, code, view_token, show_phone, scans,
                              page_views, page_viewed_at, from_form_id, created_by, created_at, archived_at)
select v.company_id,
       left(case when v.n = 1 then trim(v.name) else trim(v.name) || ' (' || v.n || ')' end, 80),
       v.kind, v.phone, v.notes, v.code, v.view_token, v.show_phone, v.scans,
       v.page_views, v.page_viewed_at, v.id, v.created_by, v.created_at,
       case when v.archived_at is not null or not v.is_active then coalesce(v.archived_at, now()) end
  from v
 where char_length(trim(v.name)) >= 2
on conflict do nothing;

update crm_leads l
   set partner_id = p.id
  from enquiry_partners p
  join enquiry_forms f on f.id = p.from_form_id
  join crm_webhook_sources s on s.id = f.source_id
 where l.company_id = p.company_id and l.source_key = s.source_key and l.partner_id is null;

update enquiry_forms f
   set archived_at = coalesce(f.archived_at, now()), view_token = null
 where f.purpose = 'vendor'
   and exists (select 1 from enquiry_partners p where p.from_form_id = f.id);

-- Every studio that had any form gets its main one now; the rest on first open.
do $$
declare r record;
begin
  for r in select distinct company_id from enquiry_forms loop
    perform enquiry_main_form_for(r.company_id);
  end loop;
end $$;

-- ── public: the form ────────────────────────────────────────────────
/**
 * Which form a link opens, and through which partner. p_key is a form's code
 * or slug, or an old vendor form's code (now a partner's). A partner counts
 * only while it is not archived.
 */
create or replace function enquiry_resolve(p_key text, p_partner text)
returns table (form_id uuid, partner_id uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_key     text := lower(trim(coalesce(p_key, '')));
  v_p       text := lower(trim(coalesce(p_partner, '')));
  v_form    enquiry_forms;
  v_partner enquiry_partners;
begin
  select * into v_form from enquiry_forms f
   where (f.code = v_key or f.slug = v_key) and f.archived_at is null;
  if not found then
    select * into v_partner from enquiry_partners where code = v_key;
    if not found then return; end if;
    v_form := enquiry_main_form_for(v_partner.company_id);
    if v_partner.archived_at is not null then v_partner := null; end if;
  elsif v_p ~ '^[a-z0-9]{6,12}$' then
    select * into v_partner from enquiry_partners
     where code = v_p and company_id = v_form.company_id and archived_at is null;
  end if;
  return query select v_form.id, v_partner.id;
end;
$$;
revoke all on function enquiry_resolve(text, text) from public, anon, authenticated;

/** What the public form shows; null when it is off or unknown. Counts one scan. */
create or replace function enquiry_public(p_key text, p_partner text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ids     record;
  v_form    enquiry_forms;
  v_company companies;
  v_partner enquiry_partners;
  v_goes    text;
begin
  select * into v_ids from enquiry_resolve(p_key, p_partner);
  if v_ids.form_id is null then return null; end if;
  select * into v_form from enquiry_forms where id = v_ids.form_id;
  if not v_form.is_active then return null; end if;
  select * into v_company from companies where id = v_form.company_id;

  if v_ids.partner_id is not null then
    update enquiry_partners set scans = scans + 1 where id = v_ids.partner_id returning * into v_partner;
  else
    update enquiry_forms set scans = scans + 1 where id = v_form.id;
  end if;

  v_goes := case v_form.after_submit
    when 'link' then 'link'
    when 'whatsapp' then case when coalesce(
      regexp_replace(coalesce(v_form.whatsapp_phone, ''), '\D', '', 'g'), '') <> ''
      or enquiry_default_whatsapp(v_form.company_id) is not null then 'whatsapp' end
  end;

  return jsonb_build_object(
    'studio', v_company.name,
    'city', v_company.city,
    'form_name', v_form.name,
    'is_open', true,
    'purpose', v_form.purpose,
    'title', v_form.title,
    'intro', v_form.intro,
    'thank_you', v_form.thank_you,
    'accent', v_form.accent,
    'logo_url', case when v_form.show_logo then v_company.invoice_logo_url end,
    'fields', v_form.fields,
    'services', to_jsonb(enquiry_services(v_form.company_id)),
    'event_types', to_jsonb(enquiry_event_types(v_form.company_id)),
    'partner', v_partner.name,
    'goes_to', v_goes);
end;
$$;
revoke all on function enquiry_public(text, text) from public, anon, authenticated;
grant execute on function enquiry_public(text, text) to service_role;

/**
 * A send. p_data carries name, phone, email, event_type, event_date, city,
 * services (array), guests, budget, message. Returns {errors} for answers
 * that need fixing, else {lead_id, created, wa_phone, wa_text, redirect_url}.
 */
create or replace function enquiry_submit(p_key text, p_partner text, p_data jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_ids      record;
  v_form     enquiry_forms;
  v_company  companies;
  v_partner  enquiry_partners;
  v_source   crm_webhook_sources;
  f          jsonb;
  v_errors   jsonb := '{}'::jsonb;
  v_name     text := left(trim(coalesce(p_data ->> 'name', '')), 120);
  v_digits   text := regexp_replace(coalesce(p_data ->> 'phone', ''), '\D', '', 'g');
  v_ten      text;
  v_email    text;
  v_event    text;
  v_date     date;
  v_city     text;
  v_services text[];
  v_guests   int;
  v_budget   numeric;
  v_message  text;
  v_said     text;
  v_lead     uuid;
  v_open     crm_leads;
  v_assignee uuid;
  v_pipeline uuid;
  v_stage    uuid;
  v_line     text;
  v_wa       text;
  v_text     text;
  v_who      uuid;
  v_fn       uuid;
begin
  select * into v_ids from enquiry_resolve(p_key, p_partner);
  if v_ids.form_id is null then
    raise exception 'This form is not taking enquiries.' using errcode = 'P0002';
  end if;
  select * into v_form from enquiry_forms where id = v_ids.form_id;
  if not v_form.is_active then
    raise exception 'This form is not taking enquiries.' using errcode = 'P0002';
  end if;
  select * into v_company from companies where id = v_form.company_id;
  select * into v_partner from enquiry_partners where id = v_ids.partner_id;
  select * into v_source from crm_webhook_sources where id = v_form.source_id;
  f := v_form.fields;

  -- Name and mobile, always.
  if char_length(v_name) < 2 then
    v_errors := v_errors || '{"name":"Enter your name"}';
  end if;
  v_ten := right(v_digits, 10);
  if length(v_digits) < 10 or length(v_digits) > 13 or v_ten !~ '^[6-9][0-9]{9}$' then
    v_errors := v_errors || '{"phone":"Enter a valid 10-digit mobile number"}';
  end if;

  -- Only the questions the form asks count; anything else sent is dropped.
  if coalesce(f ->> 'email', 'off') <> 'off' then
    v_email := nullif(left(trim(coalesce(p_data ->> 'email', '')), 200), '');
    if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_errors := v_errors || '{"email":"Enter a valid email"}';
    end if;
  end if;
  if coalesce(f ->> 'event_type', 'off') <> 'off' then
    v_event := nullif(left(trim(coalesce(p_data ->> 'event_type', '')), 80), '');
  end if;
  if coalesce(f ->> 'event_date', 'off') <> 'off' and coalesce(p_data ->> 'event_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_date := (p_data ->> 'event_date')::date;
    exception when others then
      v_date := null;
    end;
  end if;
  if coalesce(f ->> 'city', 'off') <> 'off' then
    v_city := nullif(left(trim(coalesce(p_data ->> 'city', '')), 60), '');
  end if;
  if coalesce(f ->> 'services', 'off') <> 'off' and jsonb_typeof(p_data -> 'services') = 'array' then
    -- Only the studio's own words, each once, in the studio's spelling and order.
    select array_agg(s order by o) into v_services
      from unnest(enquiry_services(v_form.company_id)) with ordinality as t(s, o)
     where exists (select 1 from jsonb_array_elements_text(p_data -> 'services') x
                    where lower(trim(x)) = lower(t.s));
  end if;
  if coalesce(f ->> 'guests', 'off') <> 'off' and coalesce(p_data ->> 'guests', '') ~ '^\d{1,6}$' then
    v_guests := nullif((p_data ->> 'guests')::int, 0);
    if v_guests > 100000 then v_guests := null; end if;
  end if;
  if coalesce(f ->> 'budget', 'off') <> 'off' and coalesce(p_data ->> 'budget', '') ~ '^\d{1,11}(\.\d+)?$' then
    v_budget := (p_data ->> 'budget')::numeric;
  end if;
  if coalesce(f ->> 'message', 'off') <> 'off' then
    v_message := nullif(left(trim(coalesce(p_data ->> 'message', '')), 1000), '');
  end if;

  -- Must-answer questions.
  if f ->> 'email' = 'required' and v_email is null and not v_errors ? 'email' then
    v_errors := v_errors || '{"email":"Please fill this in"}';
  end if;
  if f ->> 'event_type' = 'required' and v_event is null then v_errors := v_errors || '{"event_type":"Please fill this in"}'; end if;
  if f ->> 'event_date' = 'required' and v_date is null then v_errors := v_errors || '{"event_date":"Please fill this in"}'; end if;
  if f ->> 'city' = 'required' and v_city is null then v_errors := v_errors || '{"city":"Please fill this in"}'; end if;
  if f ->> 'services' = 'required' and coalesce(cardinality(v_services), 0) = 0 then
    v_errors := v_errors || '{"services":"Tick at least one"}';
  end if;
  if f ->> 'guests' = 'required' and v_guests is null then v_errors := v_errors || '{"guests":"Please fill this in"}'; end if;
  if f ->> 'budget' = 'required' and v_budget is null then v_errors := v_errors || '{"budget":"Please fill this in"}'; end if;
  if f ->> 'message' = 'required' and v_message is null then v_errors := v_errors || '{"message":"Please fill this in"}'; end if;
  if v_errors <> '{}'::jsonb then
    return jsonb_build_object('errors', v_errors);
  end if;

  -- "What they said": what they ticked, then their words.
  v_said := nullif(concat_ws(E'\n',
    case when cardinality(v_services) > 0 then 'Looking for: ' || array_to_string(v_services, ', ') end,
    v_message), '');

  -- One line for alerts: "Wedding · 14 Feb 2027 · Jaipur · via Riya Boutique".
  v_line := nullif(concat_ws(' · ', v_event, to_char(v_date, 'FMDD Mon YYYY'), v_city,
                             case when v_partner.id is not null then 'via ' || v_partner.name end), '');

  update crm_webhook_sources set last_received_at = now() where id = v_source.id;

  -- The same number while its lead is still open: no second lead, a note on that one.
  select * into v_open from crm_leads l
   where l.company_id = v_form.company_id
     and right(l.phone_norm, 10) = v_ten
     and l.merged_into is null
     and coalesce(l.is_archived, false) = false
     and l.status not in ('converted', 'lost')
   order by l.created_at desc
   limit 1;

  if found then
    v_lead := v_open.id;
    insert into crm_activities (company_id, lead_id, type, direction, subject, body, meta)
    values (v_form.company_id, v_lead, 'note', 'in', 'Enquired again',
            nullif(concat_ws(E'\n', v_said,
                   case when v_date is not null then 'Event date: ' || to_char(v_date, 'FMDD Mon YYYY') end,
                   case when v_partner.id is not null then 'Via ' || v_partner.name end), ''),
            jsonb_build_object('form_id', v_form.id, 'partner_id', v_partner.id));
    v_who := coalesce(v_open.assigned_to, v_company.owner_user_id);
    if exists (select 1 from users where user_id = v_who and company_id = v_form.company_id) then
      perform create_notification(
        v_form.company_id, v_who, 'enquiry_again', 'Enquired again: ' || coalesce(v_open.name, v_name), v_line,
        'enquiry_again:' || v_lead || ':' || to_char(now(), 'YYYYMMDDHH24MISS'),
        'lead', v_lead, 'info', '/follow-ups?lead=' || v_lead, '{}'::jsonb);
    end if;
  else
    v_assignee := coalesce(v_source.default_assigned_to, crm_pick_assignee(v_form.company_id));
    insert into crm_leads (
      company_id, name, phone, phone_norm, email, source, source_key, assigned_to, source_meta, quality,
      partner_id, event_type, event_date, city, deal_value, notes, follow_up_at)
    values (
      v_form.company_id, v_name, '+91' || v_ten, crm_normalize_phone(v_ten), v_email,
      coalesce(v_source.default_source, 'enquiry'), v_source.source_key, v_assignee,
      jsonb_build_object('form_id', v_form.id, 'form_name', v_form.name)
        || case when v_partner.id is not null
                then jsonb_build_object('partner_id', v_partner.id, 'partner_name', v_partner.name)
                else '{}'::jsonb end,
      v_source.default_quality, v_partner.id, v_event, v_date, v_city, v_budget, v_said, now())
    returning id into v_lead;

    if v_source.default_stage is not null then
      select id into v_pipeline from crm_pipelines where company_id = v_form.company_id and is_default;
      if v_pipeline is not null then
        v_stage := crm_stage_for_status(v_pipeline, v_source.default_stage);
        if v_stage is not null then
          update crm_leads set stage_id = v_stage where id = v_lead;
        end if;
      end if;
    end if;

    if v_guests is not null then
      select id into v_fn from crm_lead_functions where lead_id = v_lead order by sort, created_at limit 1;
      if v_fn is null then
        insert into crm_lead_functions (company_id, lead_id, guests) values (v_form.company_id, v_lead, v_guests);
      else
        update crm_lead_functions set guests = v_guests where id = v_fn;
      end if;
    end if;

    if exists (select 1 from users where user_id = v_company.owner_user_id and company_id = v_form.company_id) then
      perform create_notification(
        v_form.company_id, v_company.owner_user_id, 'enquiry_new', 'New enquiry: ' || v_name, v_line,
        'enquiry_new:' || v_lead, 'lead', v_lead, 'info', '/follow-ups?lead=' || v_lead, '{}'::jsonb);
    end if;
  end if;

  -- Where they go next.
  if v_form.after_submit = 'whatsapp' then
    v_wa := coalesce(nullif(regexp_replace(coalesce(v_form.whatsapp_phone, ''), '\D', '', 'g'), ''),
                     enquiry_default_whatsapp(v_form.company_id));
    if v_wa is not null then
      v_text := concat_ws(E'\n',
        coalesce(nullif(trim(v_form.whatsapp_text), ''), 'Hi ' || v_company.name || '! I just sent you an enquiry.'),
        '',
        'Name: ' || v_name,
        case when v_event is not null or v_date is not null
             then 'Event: ' || concat_ws(', ', v_event, to_char(v_date, 'FMDD Mon YYYY')) end,
        case when v_city is not null then 'City: ' || v_city end,
        case when cardinality(v_services) > 0 then 'Looking for: ' || array_to_string(v_services, ', ') end,
        case when v_guests is not null then 'Guests: ' || v_guests end);
    end if;
  end if;

  return jsonb_build_object(
    'lead_id', v_lead,
    'created', v_open.id is null,
    'wa_phone', v_wa,
    'wa_text', v_text,
    'redirect_url', case when v_form.after_submit = 'link' then v_form.redirect_url end);
end;
$$;
revoke all on function enquiry_submit(text, text, jsonb) from public, anon, authenticated;
grant execute on function enquiry_submit(text, text, jsonb) to service_role;

-- ── public: the partner's page ──────────────────────────────────────
/**
 * A partner's page by the token in their link; null for a wrong, stopped or
 * archived one. Never prices, budgets, notes or who handles a lead.
 */
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
    'leads', coalesce((
      select jsonb_agg(x order by x->>'enquired_on' desc)
        from (
          select jsonb_build_object(
                   'name', l.name,
                   'phone', case when v_p.show_phone then l.phone else enquiry_form_mask_phone(l.phone) end,
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
