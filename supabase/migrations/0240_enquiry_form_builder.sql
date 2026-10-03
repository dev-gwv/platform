-- 0240: the enquiry form a studio builds for itself.
--
-- 0195's forms were fixed vendor QR pages. A form now carries its own words
-- (title, intro, thank-you), an accent colour, which fields it asks and which
-- are required, and whether it is for a vendor's QR or the studio's own
-- website (shown in an iframe the studio pastes into its site).
--
-- Name and phone are always asked and always required (a lead needs a way
-- back). Every other field is 'off', 'optional' or 'required'; the database
-- holds the rule, so a form posted around the page cannot skip one.

alter table enquiry_forms
  add column if not exists purpose  text not null default 'vendor' check (purpose in ('vendor', 'website')),
  add column if not exists title    text check (title is null or char_length(title) <= 120),
  add column if not exists intro    text check (intro is null or char_length(intro) <= 300),
  add column if not exists thank_you text check (thank_you is null or char_length(thank_you) <= 300),
  add column if not exists accent   text check (accent is null or accent in ('blue', 'green', 'violet', 'amber', 'rose', 'teal', 'slate')),
  add column if not exists show_logo boolean not null default true,
  add column if not exists fields   jsonb not null default
    '{"email":"off","event_type":"optional","event_date":"optional","city":"optional","budget":"off","message":"optional"}'::jsonb;

-- Only the six known fields, each with one of the three settings.
create or replace function enquiry_fields_ok(p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each_text(p) e
        where e.key not in ('email', 'event_type', 'event_date', 'city', 'budget', 'message')
           or e.value not in ('off', 'optional', 'required'))
$$;
alter table enquiry_forms drop constraint if exists enquiry_forms_fields_check;
alter table enquiry_forms add constraint enquiry_forms_fields_check check (enquiry_fields_ok(fields));

grant update (purpose, title, intro, thank_you, accent, show_logo, fields) on enquiry_forms to authenticated;

-- ── what the public form shows ─────────────────────────────────────
drop function if exists enquiry_form_public(text);
create or replace function enquiry_form_public(p_code text)
returns table (studio text, form_name text, is_open boolean, purpose text, title text, intro text,
               thank_you text, accent text, logo_url text, fields jsonb)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update enquiry_forms set scans = scans + 1
   where code = lower(p_code) and is_active and archived_at is null;
  return query
    select c.name::text, f.name, (f.is_active and f.archived_at is null), f.purpose, f.title, f.intro,
           f.thank_you, f.accent, case when f.show_logo then c.invoice_logo_url end, f.fields
      from enquiry_forms f
      join companies c on c.id = f.company_id
     where f.code = lower(p_code);
end;
$$;
revoke all on function enquiry_form_public(text) from public, anon, authenticated;
grant execute on function enquiry_form_public(text) to service_role;

-- ── a submission, checked against the form's own rules ─────────────
-- Copied from 0195 with the budget and the per-form required fields added.
drop function if exists enquiry_form_submit(text, text, text, text, text, date, text, text);
create or replace function enquiry_form_submit(
  p_code       text,
  p_name       text,
  p_phone      text,
  p_email      text default null,
  p_event_type text default null,
  p_event_date date default null,
  p_city       text default null,
  p_message    text default null,
  p_budget     numeric default null
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
  v_need   text;
begin
  select f.* into v_form from enquiry_forms f
   where f.code = lower(p_code) and f.is_active and f.archived_at is null;
  if not found then
    raise exception 'This form is not taking enquiries.' using errcode = 'P0002';
  end if;

  -- Whatever the studio made required must be there.
  select string_agg(label, ', ') into v_need
    from (values
      ('email', 'your email', nullif(trim(coalesce(p_email, '')), '') is null),
      ('event_type', 'the event', nullif(trim(coalesce(p_event_type, '')), '') is null),
      ('event_date', 'the date', p_event_date is null),
      ('city', 'the city', nullif(trim(coalesce(p_city, '')), '') is null),
      ('budget', 'your budget', p_budget is null),
      ('message', 'a message', nullif(trim(coalesce(p_message, '')), '') is null)
    ) as r(key, label, missing)
   where r.missing and v_form.fields ->> r.key = 'required';
  if v_need is not null then
    raise exception 'Please add %.', v_need using errcode = '22023';
  end if;

  select source_key into v_key from crm_webhook_sources where id = v_form.source_id;

  v_new := v_norm is null or not exists (
    select 1 from crm_leads where company_id = v_form.company_id and phone_norm = v_norm);

  v_lead := capture_lead(
    v_key, trim(p_name), trim(p_phone),
    case when coalesce(v_form.fields ->> 'email', 'off') <> 'off' then nullif(trim(p_email), '') end,
    jsonb_build_object('form_id', v_form.id, 'form_name', v_form.name)
  );

  -- A field the form does not ask is never written, whatever was posted.
  if v_new then
    update crm_leads
       set event_type   = case when coalesce(v_form.fields ->> 'event_type', 'off') <> 'off' then left(nullif(trim(p_event_type), ''), 80) end,
           event_date   = case when coalesce(v_form.fields ->> 'event_date', 'off') <> 'off' then p_event_date end,
           city         = case when coalesce(v_form.fields ->> 'city', 'off') <> 'off' then left(nullif(trim(p_city), ''), 120) end,
           deal_value   = case when coalesce(v_form.fields ->> 'budget', 'off') <> 'off' and p_budget >= 0 then p_budget end,
           notes        = case when coalesce(v_form.fields ->> 'message', 'off') <> 'off' then left(nullif(trim(p_message), ''), 2000) end,
           follow_up_at = now()
     where id = v_lead;
  end if;
  return query select v_lead, coalesce(v_new, false);
end;
$$;
revoke all on function enquiry_form_submit(text, text, text, text, text, date, text, text, numeric) from public, anon, authenticated;
grant execute on function enquiry_form_submit(text, text, text, text, text, date, text, text, numeric) to service_role;
