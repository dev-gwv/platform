-- 0281: what happens after the form is sent, per partner QR (owner, 25 Oct:
-- "sometimes we need to send some unique links to different QR codes").
--
-- Each partner (enquiry_partners) may have its own after-send: a WhatsApp
-- chat (its own number and first message), a plain thank-you (its own words)
-- or a link to open. after_submit null means "same as the main form", which is
-- every partner until the studio changes one, so nothing changes for anyone.
-- A partner's WhatsApp number or first message left empty falls back to the
-- form's, then to the studio's own number.
--
-- enquiry_public and enquiry_submit are copied from 0278.
-- Safe to run twice.

alter table enquiry_partners
  add column if not exists after_submit   text check (after_submit is null or after_submit in ('thanks', 'whatsapp', 'link')),
  add column if not exists whatsapp_phone text check (whatsapp_phone is null or whatsapp_phone ~ '^\+[0-9]{10,15}$'),
  add column if not exists whatsapp_text  text check (whatsapp_text is null or char_length(whatsapp_text) <= 300),
  add column if not exists redirect_url   text check (
    redirect_url is null
    or (redirect_url ~ '^https://[^[:space:]<>"]+$' and char_length(redirect_url) <= 500)),
  add column if not exists thank_you      text check (thank_you is null or char_length(thank_you) <= 300);

alter table enquiry_partners drop constraint if exists enquiry_partners_link_needs_url;
alter table enquiry_partners add constraint enquiry_partners_link_needs_url
  check (after_submit is distinct from 'link' or redirect_url is not null);

grant update (after_submit, whatsapp_phone, whatsapp_text, redirect_url, thank_you) on enquiry_partners to authenticated;

create or replace function enquiry_public(p_key text, p_partner text default null, p_count boolean default true)
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
  v_after   text;
begin
  select * into v_ids from enquiry_resolve(p_key, p_partner);
  if v_ids.form_id is null then return null; end if;
  select * into v_form from enquiry_forms where id = v_ids.form_id;
  if not v_form.is_active then return null; end if;
  select * into v_company from companies where id = v_form.company_id;

  -- A refresh in the same visit is not another scan (the page says so).
  if v_ids.partner_id is not null then
    if p_count then
      update enquiry_partners set scans = scans + 1 where id = v_ids.partner_id returning * into v_partner;
    else
      select * into v_partner from enquiry_partners where id = v_ids.partner_id;
    end if;
  elsif p_count then
    update enquiry_forms set scans = scans + 1 where id = v_form.id;
  end if;

  -- A partner's QR may have its own after-send (0281); unset follows the form.
  v_after := coalesce(v_partner.after_submit, v_form.after_submit);
  v_goes := case v_after
    when 'link' then 'link'
    when 'whatsapp' then case when coalesce(
      regexp_replace(coalesce(v_partner.whatsapp_phone, v_form.whatsapp_phone, ''), '\D', '', 'g'), '') <> ''
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
    'thank_you', coalesce(v_partner.thank_you, v_form.thank_you),
    'accent', v_form.accent,
    'logo_url', case when v_form.show_logo then v_company.invoice_logo_url end,
    'fields', v_form.fields,
    'services', to_jsonb(enquiry_services(v_form.company_id)),
    'event_types', to_jsonb(enquiry_event_types(v_form.company_id)),
    'partner', v_partner.name,
    'goes_to', v_goes);
end;
$$;
revoke all on function enquiry_public(text, text, boolean) from public, anon, authenticated;
grant execute on function enquiry_public(text, text, boolean) to service_role;

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
  v_after    text;
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
    -- Came back through a partner's QR: the partner gets the credit if nobody had it.
    if v_partner.id is not null and v_open.partner_id is null then
      update crm_leads set partner_id = v_partner.id where id = v_lead;
    end if;
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

  -- Where they go next: the partner's own choice (0281), else the form's.
  v_after := coalesce(v_partner.after_submit, v_form.after_submit);
  if v_after = 'whatsapp' then
    v_wa := coalesce(nullif(regexp_replace(coalesce(v_partner.whatsapp_phone, v_form.whatsapp_phone, ''), '\D', '', 'g'), ''),
                     enquiry_default_whatsapp(v_form.company_id));
    if v_wa is not null then
      v_text := concat_ws(E'\n',
        coalesce(nullif(trim(v_partner.whatsapp_text), ''), nullif(trim(v_form.whatsapp_text), ''),
                 'Hi ' || v_company.name || '! I just sent you an enquiry.'),
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
    'redirect_url', case when v_after = 'link'
                         then case when v_partner.after_submit = 'link' then v_partner.redirect_url else v_form.redirect_url end end);
end;
$$;
revoke all on function enquiry_submit(text, text, jsonb) from public, anon, authenticated;
grant execute on function enquiry_submit(text, text, jsonb) to service_role;
