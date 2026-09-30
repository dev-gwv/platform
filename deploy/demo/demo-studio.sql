-- The reviewer's studio: "Demo Studio (sample data)".
--
-- Meta's app review needs a login the reviewers can use and something to look
-- at once they are in. This makes one ordinary studio -- a normal company, a
-- normal owner login, a normal 14-day trial -- and fills it with clearly
-- labelled SAMPLE leads. Nothing here is a real person: every lead's name says
-- "(sample)", carries the "Sample" label, and has a phone number that cannot
-- ring (+91 00000 ...).
--
-- It does NOT fake a connected Facebook page. A row in fb_pages would show a
-- green "Connected" for a page that is not connected. The reviewer connects
-- their own test page from Lead Sources, which is what they are there to see.
--
-- Run through deploy/demo/seed-demo.sh, which sets these psql variables first
-- (the password never appears here, only its argon2id hash):
--   :demo_email   the reviewer's login
--   :pwhash       Bun.password.hash of the password
--
-- Safe to run again: it finds the studio by the owner's email, refreshes the
-- password and the 14 days, and adds sample leads only if the studio has none.

select set_config('demo.email', lower(:'demo_email'), false),
       set_config('demo.pwhash', :'pwhash', false) \gset

do $seed$
declare
  v_email   text := current_setting('demo.email');
  v_hash    text := current_setting('demo.pwhash');
  v_uid     uuid;
  v_co      uuid;
  v_src     uuid;
  v_key     text;
  v_pipe    uuid;
  v_priya   uuid;
  v_arjun   uuid;
  v_lead    uuid;
  v_tag_s   uuid;
  v_tag_d   uuid;
  v_tag_r   uuid;
  r         record;
  i         int := 0;
  v_status  text;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'DEMO_EMAIL does not look like an email address';
  end if;
  if v_hash !~ '^\$argon2' then
    raise exception 'the password was not hashed';
  end if;

  -- ── The owner's login ───────────────────────────────────────
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid is null then
    insert into auth.users (email, encrypted_password, email_verified, email_verified_at)
      values (v_email, v_hash, true, now())
      returning id into v_uid;
  else
    -- A new password ends every session signed in with the old one.
    update auth.users
       set encrypted_password = v_hash, email_verified = true,
           email_verified_at = coalesce(email_verified_at, now()),
           password_changed_at = now(), password_version = password_version + 1
     where id = v_uid;
    perform revoke_all_sessions(v_uid);
  end if;

  -- ── The studio, made the way sign-up makes it ───────────────
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform register_company_and_admin('Demo Studio (sample data)', 'Demo Reviewer', null);
  select company_id into v_co from users where user_id = v_uid;

  update users set status = 'active', login_enabled = true where user_id = v_uid;

  -- Fourteen days from now, no plan, no grace; the setup journey and the
  -- trial reminder emails would only get in a reviewer's way.
  update companies
     set grandfathered_until = now() + interval '14 days',
         plan_expiry = null, grace_until = null,
         setup_skipped_at = coalesce(setup_skipped_at, now()),
         onboarding_emails_off = true
   where id = v_co;

  -- ── Two teammates, so "Give to" and the rota have someone ───
  -- They cannot sign in: no password, and an address that cannot receive mail.
  select id into v_priya from auth.users where email = 'priya.sample@sample.invalid';
  if v_priya is null then
    insert into auth.users (email, email_verified) values ('priya.sample@sample.invalid', true) returning id into v_priya;
  end if;
  select id into v_arjun from auth.users where email = 'arjun.sample@sample.invalid';
  if v_arjun is null then
    insert into auth.users (email, email_verified) values ('arjun.sample@sample.invalid', true) returning id into v_arjun;
  end if;
  -- Teammates belong to one studio each; a re-run for a second demo studio
  -- would find them taken, so they are named per studio.
  if exists (select 1 from users where user_id = v_priya and company_id <> v_co) then
    v_priya := null;
  end if;
  if exists (select 1 from users where user_id = v_arjun and company_id <> v_co) then
    v_arjun := null;
  end if;
  if v_priya is not null then
    insert into users (user_id, company_id, role, name, email, status, login_enabled)
      values (v_priya, v_co, 'employee', 'Priya (sample)', 'priya.sample@sample.invalid', 'active', false)
      on conflict (user_id) do nothing;
    insert into crm_distribution_rules (company_id, user_id, priority, is_active)
      values (v_co, v_priya, 1, true) on conflict do nothing;
  end if;
  if v_arjun is not null then
    insert into users (user_id, company_id, role, name, email, status, login_enabled)
      values (v_arjun, v_co, 'employee', 'Arjun (sample)', 'arjun.sample@sample.invalid', 'active', false)
      on conflict (user_id) do nothing;
    insert into crm_distribution_rules (company_id, user_id, priority, is_active)
      values (v_co, v_arjun, 2, true) on conflict do nothing;
  end if;

  -- ── Labels ──────────────────────────────────────────────────
  insert into crm_tags (company_id, name, color) values (v_co, 'Sample', 'amber') on conflict do nothing;
  insert into crm_tags (company_id, name, color) values (v_co, 'Destination', 'violet') on conflict do nothing;
  insert into crm_tags (company_id, name, color) values (v_co, 'Referral', 'teal') on conflict do nothing;
  select id into v_tag_s from crm_tags where company_id = v_co and lower(name) = 'sample';
  select id into v_tag_d from crm_tags where company_id = v_co and lower(name) = 'destination';
  select id into v_tag_r from crm_tags where company_id = v_co and lower(name) = 'referral';

  -- ── The lead source: what a connected page would have made ──
  select id, source_key into v_src, v_key from crm_webhook_sources
   where company_id = v_co and label = 'Facebook lead ads (sample)';
  if v_src is null then
    v_key := 'demo-' || replace(gen_random_uuid()::text, '-', '');
    insert into crm_webhook_sources (company_id, source_key, kind, label, source_type, default_source)
      values (v_co, v_key, 'meta', 'Facebook lead ads (sample)', 'webhook', 'facebook')
      returning id into v_src;
  end if;

  -- ── Sample leads: only into a studio that has none yet ──────
  if exists (select 1 from crm_leads where company_id = v_co and source_key = v_key) then
    raise notice 'sample leads already there: left as they are';
    return;
  end if;

  select id into v_pipe from crm_pipelines where company_id = v_co and is_default;

  for r in
    select * from (values
      -- name, city, status, quality, days ago, events (type|date offset days|venue;...), labels
      ('Ananya & Rohan (sample)',   'Jaipur',    'new',           'hot',  1,  'Wedding|75|Udaipur;Haldi|73|Udaipur;Reception|76|Udaipur', 'D'),
      ('Meera & Karthik (sample)',  'Chennai',   'new',           'warm', 2,  'Wedding|120|Chennai', ''),
      ('Sana & Imran (sample)',     'Hyderabad', 'new',           'hot',  2,  'Nikah|60|Hyderabad;Reception|61|Hyderabad', 'R'),
      ('Kavya (sample)',            'Bengaluru', 'new',           null,   3,  'Birthday|30|Bengaluru', ''),
      ('Ishita & Aman (sample)',    'Delhi',     'contacted',     'warm', 5,  'Engagement|45|Delhi;Wedding|110|Jaipur', 'D'),
      ('Pooja & Nikhil (sample)',   'Pune',      'contacted',     'hot',  6,  'Pre-wedding|25|Lonavala', 'R'),
      ('Riya (sample)',             'Mumbai',    'contacted',     'cold', 7,  'Baby shoot|20|Mumbai', ''),
      ('Tanvi & Dev (sample)',      'Kolkata',   'qualified',     'hot',  9,  'Wedding|90|Kolkata;Sangeet|89|Kolkata;Reception|91|Kolkata', 'R'),
      ('Neha & Sameer (sample)',    'Lucknow',   'qualified',     'warm', 11, 'Wedding|140|Lucknow', ''),
      ('Divya (sample)',            'Ahmedabad', 'qualified',     'warm', 12, 'Maternity|35|Ahmedabad', ''),
      ('Simran & Harpreet (sample)','Chandigarh','proposal_sent', 'hot',  14, 'Wedding|100|Chandigarh;Engagement|55|Chandigarh', 'R'),
      ('Aditi & Vivek (sample)',    'Goa',       'proposal_sent', 'warm', 16, 'Wedding|130|Goa', 'D'),
      ('Fatima & Zaid (sample)',    'Bhopal',    'converted',     'hot',  20, 'Nikah|40|Bhopal', 'R'),
      ('Lakshmi (sample)',          'Kochi',     'lost',          'cold', 21, 'Birthday|15|Kochi', '')
    ) as t(name, city, status, quality, days_ago, events, labels)
  loop
    i := i + 1;
    v_lead := capture_lead(
      v_key, r.name, format('+91 00000 %s', lpad(i::text, 5, '0')), null,
      jsonb_build_object(
        'page_id', 'sample-page', 'page_name', 'Sample page', 'form_id', 'sample-form',
        'leadgen_id', 'sample-' || i,
        'fields', jsonb_build_object('full_name', r.name, 'city', r.city, 'sample', 'yes'))
    );

    v_status := r.status;
    update crm_leads
       set city = r.city,
           quality = r.quality,
           notes = 'Sample lead made for Meta''s app review. Not a real person.',
           assigned_to = case when i % 2 = 0 then coalesce(v_priya, v_uid) else coalesce(v_arjun, v_uid) end,
           created_at = now() - make_interval(days => r.days_ago),
           contacted_status = case when v_status = 'new' then 'uncontacted' else 'contacted' end,
           last_contacted_at = case when v_status = 'new' then null else now() - make_interval(days => greatest(r.days_ago - 1, 0)) end
     where id = v_lead;

    -- A lost lead needs its reason on the way in (0037).
    update crm_leads
       set status = v_status,
           lost_reason = case when v_status = 'lost' then 'Chose a cheaper studio' end
     where id = v_lead;

    -- The events, one row each.
    insert into crm_lead_functions (company_id, lead_id, event_type, event_date, location, sort)
      select v_co, v_lead, split_part(e, '|', 1),
             (current_date + split_part(e, '|', 2)::int), split_part(e, '|', 3), n - 1
        from unnest(string_to_array(r.events, ';')) with ordinality as x(e, n);

    -- Labels: every one carries "Sample".
    insert into crm_lead_tags (lead_id, tag_id) values (v_lead, v_tag_s) on conflict do nothing;
    if r.labels like '%D%' then insert into crm_lead_tags (lead_id, tag_id) values (v_lead, v_tag_d) on conflict do nothing; end if;
    if r.labels like '%R%' then insert into crm_lead_tags (lead_id, tag_id) values (v_lead, v_tag_r) on conflict do nothing; end if;

    -- The import log a connected page would have left.
    insert into fb_lead_imports (company_id, source_id, page_id, page_name, leadgen_id, name, phone, status, lead_id, created_at)
      values (v_co, v_src, 'sample-page', 'Sample page', 'sample-' || i, r.name,
              format('+91 00000 %s', lpad(i::text, 5, '0')), 'imported', v_lead, now() - make_interval(days => r.days_ago));
  end loop;

  -- One repeat and one failure, so the log shows every kind of row.
  insert into fb_lead_imports (company_id, source_id, page_id, page_name, leadgen_id, name, phone, status, created_at)
    values (v_co, v_src, 'sample-page', 'Sample page', 'sample-dup', 'Ananya & Rohan (sample)', '+91 00000 00001', 'duplicate', now() - interval '20 hours');
  insert into fb_lead_imports (company_id, source_id, page_id, page_name, leadgen_id, name, phone, status, error, created_at)
    values (v_co, v_src, 'sample-page', 'Sample page', 'sample-bad', 'Form with no phone (sample)', null, 'failed', 'Sample: this form had no phone number', now() - interval '3 days');

  -- Call-back dates: a few today, one overdue, one tomorrow.
  update crm_leads set follow_up_at = date_trunc('day', now()) + interval '11 hours' where company_id = v_co and name like 'Ishita%';
  update crm_leads set follow_up_at = date_trunc('day', now()) + interval '16 hours' where company_id = v_co and name like 'Pooja%';
  update crm_leads set follow_up_at = now() - interval '1 day' where company_id = v_co and name like 'Neha%';
  update crm_leads set follow_up_at = date_trunc('day', now()) + interval '1 day 10 hours' where company_id = v_co and name like 'Tanvi%';
end
$seed$;

-- What was made, with no secrets: counts only.
select c.name as studio,
       to_char(c.grandfathered_until, 'DD Mon YYYY') as access_until,
       (select count(*) from crm_leads l where l.company_id = c.id) as sample_leads,
       (select count(*) from fb_lead_imports f where f.company_id = c.id) as import_rows
  from companies c
 where c.id = (select company_id from users where lower(email) = lower(:'demo_email') limit 1);
