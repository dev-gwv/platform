-- 0195: enquiry forms -- one QR per vendor, leads credited to it, and a
-- read-only page the vendor can open.
--
-- A studio hands a QR to a boutique, a venue or a decorator. Someone scans it,
-- fills in a short form, and the enquiry lands in Leads like any other. The
-- studio sees which QR brought each lead; the vendor gets a page of their own
-- that lists what their QR brought in, so neither side has to take the other's
-- word for it.
--
-- One row here is one QR is one vendor. Each owns a lead source
-- (crm_webhook_sources) and every submission goes through capture_lead with
-- that source's key, so the phone dedupe, the rota and the Lead Sources counts
-- all work as they already do. capture_lead is not edited: the event fields it
-- cannot take are set here afterwards, and only on a lead it just created.

-- ── the source kind ─────────────────────────────────────────────
alter table crm_webhook_sources drop constraint if exists crm_webhook_sources_source_type_check;
alter table crm_webhook_sources add constraint crm_webhook_sources_source_type_check
  check (source_type in ('website_form', 'google_form', 'elementor', 'landing_page', 'webhook', 'other',
                         'enquiry_form'));

-- ── the form ────────────────────────────────────────────────────
create table if not exists enquiry_forms (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies (id) on delete cascade,
  name            text not null check (char_length(trim(name)) between 1 and 120),
  kind            text check (kind is null or char_length(kind) <= 60),
  phone           text check (phone is null or char_length(phone) <= 30),
  notes           text check (notes is null or char_length(notes) <= 1000),
  -- The public link is /enquire/<code>. Short enough to type off a poster;
  -- no 0/o/1/l/i so it reads cleanly.
  code            text not null unique check (code ~ '^[a-hj-km-np-z2-9]{7}$'),
  source_id       uuid not null unique references crm_webhook_sources (id) on delete cascade,
  -- The vendor's page. Null means it is off; a new link replaces the old one.
  -- Kept as is, not hashed like the client portal's: the studio copies it
  -- again whenever it re-sends the link, and anyone who can read this row
  -- can already see every lead it shows.
  view_token      text unique check (view_token is null or view_token ~ '^[A-Za-z0-9_-]{20,100}$'),
  show_phone      boolean not null default false,
  scans           int not null default 0,
  page_views      int not null default 0,
  page_viewed_at  timestamptz,
  is_active       boolean not null default true,
  archived_at     timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists enquiry_forms_company_idx on enquiry_forms (company_id, created_at desc);

alter table enquiry_forms enable row level security;
drop policy if exists enquiry_forms_select on enquiry_forms;
create policy enquiry_forms_select on enquiry_forms
  for select to authenticated using (company_id = get_current_company_id());
drop policy if exists enquiry_forms_write on enquiry_forms;
create policy enquiry_forms_write on enquiry_forms
  for update to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());
-- Created through create_enquiry_form (it makes the source too); never deleted
-- from the app, only switched off or archived, so the leads keep their credit.
grant select on enquiry_forms to authenticated;
grant update (name, kind, phone, notes, show_phone, is_active, archived_at) on enquiry_forms to authenticated;

-- ── creating one ────────────────────────────────────────────────
create or replace function create_enquiry_form(
  p_name  text,
  p_kind  text default null,
  p_phone text default null,
  p_notes text default null
)
returns enquiry_forms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_alpha   constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_code    text;
  v_source  uuid;
  v_row     enquiry_forms;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'Give the form a name.' using errcode = '22023';
  end if;

  -- The code is public (it is on the poster), so random() is enough; the
  -- loop only guards the rare clash.
  loop
    select string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1), '')
      into v_code from generate_series(1, 7);
    exit when not exists (select 1 from enquiry_forms where code = v_code);
  end loop;

  insert into crm_webhook_sources (company_id, source_key, kind, label, source_type, default_source)
  values (v_company,
          replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
          'webform', trim(p_name), 'enquiry_form', 'enquiry')
  returning id into v_source;

  insert into enquiry_forms (company_id, name, kind, phone, notes, code, source_id, created_by)
  values (v_company, trim(p_name), nullif(trim(p_kind), ''), nullif(trim(p_phone), ''),
          nullif(trim(p_notes), ''), v_code, v_source, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function create_enquiry_form(text, text, text, text) from public, anon;
grant execute on function create_enquiry_form(text, text, text, text) to authenticated;

-- Keep the source in step: its label is the form's name, and a form that is
-- off or archived takes no leads (capture_lead refuses an inactive source).
create or replace function enquiry_forms_sync_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  update crm_webhook_sources
     set label = new.name,
         is_active = new.is_active and new.archived_at is null
   where id = new.source_id;
  return new;
end;
$$;
drop trigger if exists enquiry_forms_sync_source on enquiry_forms;
create trigger enquiry_forms_sync_source
  before update on enquiry_forms
  for each row execute function enquiry_forms_sync_source();

/** Turn the vendor's page on with a new link, or off with null. */
create or replace function enquiry_form_set_page(p_id uuid, p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update enquiry_forms set view_token = p_token
   where id = p_id and company_id = v_company;
  return found;
end;
$$;
revoke all on function enquiry_form_set_page(uuid, text) from public, anon;
grant execute on function enquiry_form_set_page(uuid, text) to authenticated;

-- ── numbers per form ────────────────────────────────────────────
-- Enquiries are the leads credited to the form's source; booked are the ones
-- that became a client. security_invoker so a studio sees only its own.
create or replace view enquiry_form_stats with (security_invoker = true) as
  select f.id as form_id,
         count(l.id)::int as enquiries,
         count(l.id) filter (where l.status = 'converted')::int as booked,
         max(l.created_at) as last_enquiry_at
    from enquiry_forms f
    join crm_webhook_sources s on s.id = f.source_id
    left join crm_leads l on l.company_id = f.company_id and l.source_key = s.source_key
   group by f.id;
grant select on enquiry_form_stats to authenticated;

-- ── public: the form ────────────────────────────────────────────
/** What the public form shows. Counts a scan each time it is opened. */
create or replace function enquiry_form_public(p_code text)
returns table (studio text, form_name text, is_open boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update enquiry_forms set scans = scans + 1
   where code = lower(p_code) and is_active and archived_at is null;
  return query
    select c.name::text, f.name, (f.is_active and f.archived_at is null)
      from enquiry_forms f
      join companies c on c.id = f.company_id
     where f.code = lower(p_code);
end;
$$;
revoke all on function enquiry_form_public(text) from public, anon, authenticated;
grant execute on function enquiry_form_public(text) to service_role;

/**
 * A submission. Goes through capture_lead so the phone dedupe and the rota
 * apply; a number already on file returns that lead untouched. A new lead
 * gets the event details, the message in its notes, and is due today.
 */
create or replace function enquiry_form_submit(
  p_code       text,
  p_name       text,
  p_phone      text,
  p_email      text default null,
  p_event_type text default null,
  p_event_date date default null,
  p_city       text default null,
  p_message    text default null
)
returns table (lead_id uuid, created boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_form   enquiry_forms;
  v_key    text;
  v_norm   text := crm_normalize_phone(p_phone);
  v_lead   uuid;
  v_new    boolean;
begin
  select f.* into v_form from enquiry_forms f
   where f.code = lower(p_code) and f.is_active and f.archived_at is null;
  if not found then
    raise exception 'This form is not taking enquiries.' using errcode = 'P0002';
  end if;
  select source_key into v_key from crm_webhook_sources where id = v_form.source_id;

  -- capture_lead returns the lead already on file for this number; only a
  -- lead made just now is ours to fill in.
  v_new := v_norm is null or not exists (
    select 1 from crm_leads where company_id = v_form.company_id and phone_norm = v_norm);

  v_lead := capture_lead(
    v_key, trim(p_name), trim(p_phone), nullif(trim(p_email), ''),
    jsonb_build_object('form_id', v_form.id, 'form_name', v_form.name)
  );

  if v_new then
    update crm_leads
       set event_type   = left(nullif(trim(p_event_type), ''), 80),
           event_date   = p_event_date,
           city         = left(nullif(trim(p_city), ''), 120),
           notes        = left(nullif(trim(p_message), ''), 2000),
           follow_up_at = now()
     where id = v_lead;
  end if;
  return query select v_lead, coalesce(v_new, false);
end;
$$;
revoke all on function enquiry_form_submit(text, text, text, text, text, date, text, text) from public, anon, authenticated;
grant execute on function enquiry_form_submit(text, text, text, text, text, date, text, text) to service_role;

-- ── public: the vendor's page ───────────────────────────────────
/** Four plain words for where a lead stands; the vendor does not need our stages. */
create or replace function enquiry_form_status(p_status text)
returns text
language sql
immutable
as $$
  select case p_status
    when 'converted' then 'Booked'
    when 'lost' then 'Not booked'
    when 'contacted' then 'In talks'
    when 'qualified' then 'In talks'
    when 'proposal_sent' then 'In talks'
    else 'New'
  end
$$;

create or replace function enquiry_form_mask_phone(p_phone text)
returns text
language sql
immutable
as $$
  -- 98765 43210 -> 98xxxxx210: enough to recognise, not enough to call.
  select case
    when p_phone is null then null
    when length(regexp_replace(p_phone, '\D', '', 'g')) < 6 then 'xxxxxx'
    else left(right(regexp_replace(p_phone, '\D', '', 'g'), 10), 2) || 'xxxxx'
         || right(regexp_replace(p_phone, '\D', '', 'g'), 3)
  end
$$;

/**
 * The vendor's page, by the raw token in their link. No row for a wrong or
 * stopped link. Phones are masked unless the studio chose to show them.
 */
create or replace function enquiry_form_page(p_raw text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_form enquiry_forms;
  v_key  text;
  v_out  jsonb;
begin
  select f.* into v_form from enquiry_forms f
   where f.view_token = p_raw and p_raw is not null
     and f.archived_at is null;
  if not found then return null; end if;

  update enquiry_forms set page_views = page_views + 1, page_viewed_at = now() where id = v_form.id;
  select source_key into v_key from crm_webhook_sources where id = v_form.source_id;

  select jsonb_build_object(
    'studio', (select name from companies where id = v_form.company_id),
    'form_name', v_form.name,
    'scans', v_form.scans,
    'enquiries', (select count(*) from crm_leads where company_id = v_form.company_id and source_key = v_key),
    'booked', (select count(*) from crm_leads
                where company_id = v_form.company_id and source_key = v_key and status = 'converted'),
    'leads', coalesce((
      select jsonb_agg(x order by x->>'enquired_on' desc)
        from (
          select jsonb_build_object(
                   'name', l.name,
                   'phone', case when v_form.show_phone then l.phone else enquiry_form_mask_phone(l.phone) end,
                   'enquired_on', l.created_at,
                   'event_type', l.event_type,
                   'event_date', l.event_date,
                   'status', enquiry_form_status(l.status)
                 ) as x
            from crm_leads l
           where l.company_id = v_form.company_id and l.source_key = v_key
           order by l.created_at desc
           limit 200
        ) t
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function enquiry_form_page(text) from public, anon, authenticated;
grant execute on function enquiry_form_page(text) to service_role;
