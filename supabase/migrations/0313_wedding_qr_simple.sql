-- 0313: claim -- wedding QR codes made like your own QR: a name, no project;
-- the guest form asks name, phone, email and whether a wedding is coming up;
-- wedding QRs get their own "After they send".
--
-- Owner, 19 Nov: "when I'm going to the wedding QR code, it is asking me for a
-- project. It should not ... It should be the same as your QR code system
-- only." A wedding QR is made with just the couple's name, the way a studio
-- makes its own QR; a first-timer can make one in one step.
--
--   * create_wedding_qr_named(name): no project; the name is what the form
--     shows ("Priya & Rahul's wedding"). The same name again gives back that
--     QR (bringing it back if it was deleted). 0299's create_wedding_qr(project)
--     stays for the project page's "Make wedding QR".
--   * The guest form of a wedding QR asks only name, mobile, email and "Do you
--     have a wedding in the coming months?"; on Yes, when and where
--     (enquiry_wedding_fields). The answer is kept on the lead like a partner
--     QR's own questions (crm_leads.enquiry_answers), and Yes makes the lead's
--     event "Wedding".
--   * Wedding QRs have their own "After they send" (enquiry_forms.wedding_*):
--     null follows the main form, as every wedding QR did until now. A wedding
--     QR's own after-send (enquiry_partners, 0281) still wins.
--
-- enquiry_public and enquiry_submit are copied from 0281.
-- Safe to run twice.

alter table enquiry_forms
  add column if not exists wedding_after_submit   text check (wedding_after_submit is null or wedding_after_submit in ('thanks', 'whatsapp', 'link')),
  add column if not exists wedding_whatsapp_phone text check (wedding_whatsapp_phone is null or wedding_whatsapp_phone ~ '^\+[0-9]{10,15}$'),
  add column if not exists wedding_whatsapp_text  text check (wedding_whatsapp_text is null or char_length(wedding_whatsapp_text) <= 300),
  add column if not exists wedding_redirect_url   text check (
    wedding_redirect_url is null
    or (wedding_redirect_url ~ '^https://[^[:space:]<>"]+$' and char_length(wedding_redirect_url) <= 500)),
  add column if not exists wedding_thank_you      text check (wedding_thank_you is null or char_length(wedding_thank_you) <= 300);
alter table enquiry_forms drop constraint if exists enquiry_forms_wedding_link_needs_url;
alter table enquiry_forms add constraint enquiry_forms_wedding_link_needs_url
  check (wedding_after_submit is distinct from 'link' or wedding_redirect_url is not null);
grant update (wedding_after_submit, wedding_whatsapp_phone, wedding_whatsapp_text, wedding_redirect_url, wedding_thank_you)
  on enquiry_forms to authenticated;

/** What a wedding QR's form asks: email, and (on "Yes") when and where. */
create or replace function enquiry_wedding_fields()
returns jsonb
language sql
immutable
as $$
  select '{"email":"optional","event_type":"off","event_date":"optional","city":"optional","services":"off","guests":"off","budget":"off","message":"off"}'::jsonb
$$;

/**
 * A wedding QR with just a name (0313). Unique among the studio's wedding QRs:
 * the same name gives back that one, brought back if it was deleted.
 */
create or replace function create_wedding_qr_named(p_name text)
returns enquiry_partners
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_name    text := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 70);
  v_row     enquiry_partners;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 then
    raise exception 'Type the couple''s names.' using errcode = '22023';
  end if;
  select * into v_row from enquiry_partners
   where company_id = v_company and kind = 'wedding' and lower(name) = lower(v_name);
  if found then
    if v_row.archived_at is not null then
      update enquiry_partners set archived_at = null where id = v_row.id returning * into v_row;
    end if;
    return v_row;
  end if;
  perform enquiry_main_form_for(v_company);
  insert into enquiry_partners (company_id, kind, project_id, name, occasion, code, view_token, created_by)
  values (v_company, 'wedding', null, v_name, v_name, enquiry_new_partner_code(), null, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function create_wedding_qr_named(text) from public, anon;
grant execute on function create_wedding_qr_named(text) to authenticated;

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
  v_wedding boolean;
  v_phone   text;
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

  -- A wedding QR (0313) asks its own few questions and has its own
  -- after-send, which follows the main form until the studio sets one.
  v_wedding := coalesce(v_partner.kind = 'wedding', false);

  -- A partner's QR may have its own after-send (0281); unset follows the
  -- wedding QRs' (for a wedding QR), then the form's.
  v_after := coalesce(v_partner.after_submit, case when v_wedding then v_form.wedding_after_submit end, v_form.after_submit);
  v_phone := coalesce(v_partner.whatsapp_phone, case when v_wedding then v_form.wedding_whatsapp_phone end, v_form.whatsapp_phone);
  v_goes := case v_after
    when 'link' then 'link'
    when 'whatsapp' then case when coalesce(regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), '') <> ''
      or enquiry_default_whatsapp(v_form.company_id) is not null then 'whatsapp' end
  end;

  return jsonb_build_object(
    'studio', v_company.name,
    'city', v_company.city,
    'form_name', v_form.name,
    'is_open', true,
    'purpose', v_form.purpose,
    'title', case when v_wedding then 'Loved our work? Tell us about your wedding' else v_form.title end,
    'intro', case when v_wedding then 'Leave your number and we will get in touch.' else v_form.intro end,
    'thank_you', coalesce(v_partner.thank_you, case when v_wedding then v_form.wedding_thank_you end, v_form.thank_you),
    'accent', v_form.accent,
    'logo_url', case when v_form.show_logo then v_company.invoice_logo_url end,
    'fields', case when v_wedding then enquiry_wedding_fields() else v_form.fields end,
    'wedding', v_wedding,
    'services', to_jsonb(enquiry_services(v_form.company_id)),
    'event_types', to_jsonb(enquiry_event_types(v_form.company_id)),
    'partner', v_partner.name,
    'occasion', v_partner.occasion,
    'questions', case when v_wedding then '[]'::jsonb else coalesce(v_partner.questions, '[]'::jsonb) end,
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
  v_answers  jsonb := '[]'::jsonb;
  v_q        jsonb;
  v_a        text;
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
  v_wedding  boolean;
  v_soon     text;
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

  -- A wedding QR (0313) asks only name, mobile, email and whether a wedding
  -- is coming up; when it is, when and where.
  v_wedding := coalesce(v_partner.kind = 'wedding', false);
  if v_wedding then
    v_soon := case lower(coalesce(p_data ->> 'wedding_soon', '')) when 'yes' then 'yes' when 'no' then 'no' end;
    f := enquiry_wedding_fields();
    if v_soon is distinct from 'yes' then
      f := f || '{"event_date":"off","city":"off"}';
    end if;
  end if;

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
  if v_wedding then
    if v_soon is null then
      v_errors := v_errors || '{"wedding_soon":"Pick one"}';
    else
      v_answers := jsonb_build_array(jsonb_build_object(
        'question', 'Do you have a wedding in the coming months?',
        'answer', case v_soon when 'yes' then 'Yes' else 'No' end));
      if v_soon = 'yes' then v_event := 'Wedding'; end if;
    end if;
  end if;
  -- The partner QR's own questions (0281): keyed "q:<id>" in the errors.
  -- A wedding QR has none of its own (0313).
  for v_q in select q from jsonb_array_elements(case when v_wedding then '[]'::jsonb else coalesce(v_partner.questions, '[]'::jsonb) end) q loop
    v_a := nullif(left(trim(coalesce(p_data -> 'answers' ->> (v_q ->> 'id'), '')), 500), '');
    if v_a is not null and v_q ->> 'kind' = 'choice'
       and not exists (select 1 from jsonb_array_elements_text(v_q -> 'options') o where o = v_a) then
      v_a := null;
    end if;
    if v_a is null and coalesce((v_q ->> 'required')::boolean, false) then
      v_errors := v_errors || jsonb_build_object('q:' || (v_q ->> 'id'),
        case when v_q ->> 'kind' = 'choice' then 'Pick one' else 'Please fill this in' end);
    elsif v_a is not null then
      v_answers := v_answers || jsonb_build_array(jsonb_build_object('question', trim(v_q ->> 'label'), 'answer', v_a));
    end if;
  end loop;
  if jsonb_array_length(v_answers) = 0 then v_answers := null; end if;

  if v_errors <> '{}'::jsonb then
    return jsonb_build_object('errors', v_errors);
  end if;

  -- "What they said": what they ticked, then their words.
  v_said := nullif(concat_ws(E'\n',
    case when cardinality(v_services) > 0 then 'Looking for: ' || array_to_string(v_services, ', ') end,
    v_message), '');

  -- One line for alerts: "Wedding · 14 Feb 2027 · Jaipur · via Riya Boutique".
  v_line := nullif(concat_ws(' · ', v_event, to_char(v_date, 'FMDD Mon YYYY'), v_city,
                             case when v_partner.id is not null then 'via ' || v_partner.name end,
                             v_partner.occasion), '');

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
                   case when v_partner.id is not null then 'Via ' || v_partner.name end,
                   case when v_partner.occasion is not null then 'For: ' || v_partner.occasion end,
                   (select string_agg((x ->> 'question') || ': ' || (x ->> 'answer'), E'\n')
                      from jsonb_array_elements(coalesce(v_answers, '[]'::jsonb)) x)), ''),
            jsonb_build_object('form_id', v_form.id, 'partner_id', v_partner.id));
    -- Came back through a partner's QR: the partner gets the credit if nobody had it.
    if v_partner.id is not null and v_open.partner_id is null then
      update crm_leads set partner_id = v_partner.id where id = v_lead;
    end if;
    update crm_leads
       set enquiry_occasion = coalesce(enquiry_occasion, v_partner.occasion),
           enquiry_answers  = coalesce(enquiry_answers, v_answers)
     where id = v_lead and (enquiry_occasion is null or enquiry_answers is null);
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
      partner_id, event_type, event_date, city, deal_value, notes, follow_up_at, enquiry_occasion, enquiry_answers)
    values (
      v_form.company_id, v_name, '+91' || v_ten, crm_normalize_phone(v_ten), v_email,
      coalesce(v_source.default_source, 'enquiry'), v_source.source_key, v_assignee,
      jsonb_build_object('form_id', v_form.id, 'form_name', v_form.name)
        || case when v_partner.id is not null
                then jsonb_build_object('partner_id', v_partner.id, 'partner_name', v_partner.name)
                else '{}'::jsonb end,
      v_source.default_quality, v_partner.id, v_event, v_date, v_city, v_budget, v_said, now(),
      v_partner.occasion, v_answers)
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

  -- Where they go next: the partner's own choice (0281), else the wedding
  -- QRs' for a wedding QR (0313), else the form's.
  v_after := coalesce(v_partner.after_submit, case when v_wedding then v_form.wedding_after_submit end, v_form.after_submit);
  if v_after = 'whatsapp' then
    v_wa := coalesce(nullif(regexp_replace(coalesce(v_partner.whatsapp_phone,
                       case when v_wedding then v_form.wedding_whatsapp_phone end, v_form.whatsapp_phone, ''), '\D', '', 'g'), ''),
                     enquiry_default_whatsapp(v_form.company_id));
    if v_wa is not null then
      v_text := concat_ws(E'\n',
        coalesce(nullif(trim(v_partner.whatsapp_text), ''),
                 case when v_wedding then nullif(trim(v_form.wedding_whatsapp_text), '') end,
                 nullif(trim(v_form.whatsapp_text), ''),
                 'Hi ' || v_company.name || '! I just sent you an enquiry.'),
        '',
        'Name: ' || v_name,
        case when v_event is not null or v_date is not null
             then 'Event: ' || concat_ws(', ', v_event, to_char(v_date, 'FMDD Mon YYYY')) end,
        case when v_city is not null then 'City: ' || v_city end,
        case when cardinality(v_services) > 0 then 'Looking for: ' || array_to_string(v_services, ', ') end,
        case when v_guests is not null then 'Guests: ' || v_guests end,
        case when v_partner.occasion is not null then 'For: ' || v_partner.occasion end,
        (select string_agg((x ->> 'question') || ': ' || (x ->> 'answer'), E'\n')
           from jsonb_array_elements(coalesce(v_answers, '[]'::jsonb)) x));
    end if;
  end if;

  return jsonb_build_object(
    'lead_id', v_lead,
    'created', v_open.id is null,
    'wa_phone', v_wa,
    'wa_text', v_text,
    'redirect_url', case when v_after = 'link'
                         then case when v_partner.after_submit = 'link' then v_partner.redirect_url
                                   when v_wedding and v_form.wedding_after_submit = 'link' then v_form.wedding_redirect_url
                                   else v_form.redirect_url end end);
end;
$$;
revoke all on function enquiry_submit(text, text, jsonb) from public, anon, authenticated;
grant execute on function enquiry_submit(text, text, jsonb) to service_role;
