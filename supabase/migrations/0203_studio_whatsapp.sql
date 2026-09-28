-- 0203: the studio's own WhatsApp number (WhatsApp Cloud API).
--
-- Studios want their own number and name on WhatsApp, not the platform's.
-- A studio with the whatsapp_api switch (0202) connects its WhatsApp
-- Business number -- by Meta's Embedded Signup, or by pasting the phone
-- number id, business account id and a permanent token -- and from then on:
--
--   * a sequence's WhatsApp step goes out by itself from that number, when
--     WhatsApp allows it: always with an approved template, or as plain text
--     inside the 24 hours after the client last wrote;
--   * anything else still waits in "Send now" for a tap, as before;
--   * a client's reply lands on the lead's timeline (a new number becomes a
--     new lead), stops a sequence that says so, and tells the lead's owner;
--   * delivery receipts (delivered / read / failed) land on the message.
--
-- The access token is encrypted by the API before it is stored
-- (WHATSAPP_TOKEN_KEY) and no signed-in user can read this table: the
-- screens get the connection's status from company_whatsapp_status().

create table if not exists company_whatsapp (
  company_id       uuid primary key references companies (id) on delete cascade,
  phone_number_id  text not null check (phone_number_id ~ '^[0-9]{5,30}$'),
  waba_id          text not null check (waba_id ~ '^[0-9]{5,30}$'),
  display_phone    text,
  verified_name    text,
  access_token_enc text not null,
  app_secret_enc   text,
  -- The unguessable part of this studio's own webhook address, and the
  -- verify token Meta's handshake must echo. Both made by the API.
  webhook_key      text not null unique check (char_length(webhook_key) >= 24),
  verify_token     text not null check (char_length(verify_token) >= 16),
  via              text not null default 'manual' check (via in ('manual', 'embedded')),
  status           text not null default 'connected' check (status in ('connected', 'error')),
  last_error       text,
  connected_at     timestamptz not null default now(),
  connected_by     uuid,
  templates_synced_at timestamptz
);
-- One number, one studio.
create unique index if not exists company_whatsapp_phone_uq on company_whatsapp (phone_number_id);
alter table company_whatsapp enable row level security;
-- No policies: only the service reads it. Revoke in case 0000 granted it.
revoke all on company_whatsapp from authenticated, anon;

-- What the screens may know about the connection: never the token.
create or replace function company_whatsapp_status()
returns table (
  connected boolean, phone_number_id text, waba_id text, display_phone text, verified_name text,
  via text, status text, last_error text, connected_at timestamptz, templates_synced_at timestamptz,
  webhook_key text, verify_token text, has_app_secret boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select true, w.phone_number_id, w.waba_id, w.display_phone, w.verified_name,
         w.via, w.status, w.last_error, w.connected_at, w.templates_synced_at,
         w.webhook_key, w.verify_token, w.app_secret_enc is not null
    from company_whatsapp w
   where w.company_id = get_current_company_id()
$$;
revoke all on function company_whatsapp_status() from public, anon;
grant execute on function company_whatsapp_status() to authenticated;

-- The studio's approved message templates, copied from Meta on "Sync".
create table if not exists company_whatsapp_templates (
  company_id  uuid not null references companies (id) on delete cascade,
  name        text not null,
  language    text not null,
  status      text not null,
  category    text,
  body        text,
  param_count int not null default 0,
  synced_at   timestamptz not null default now(),
  primary key (company_id, name, language)
);
alter table company_whatsapp_templates enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'company_whatsapp_templates_select') then
    create policy company_whatsapp_templates_select on company_whatsapp_templates for select to authenticated
      using (company_id = get_current_company_id());
  end if;
end $$;
grant select on company_whatsapp_templates to authenticated;

-- A WhatsApp step may name an approved template, and which of our words
-- fill its {{1}}, {{2}}...: ["first_name", "event_type"].
alter table crm_cadence_steps
  add column if not exists wa_template_name text,
  add column if not exists wa_template_lang text,
  add column if not exists wa_params jsonb check (wa_params is null or jsonb_typeof(wa_params) = 'array');

alter table crm_sequence_sends
  add column if not exists wa_template_name text,
  add column if not exists wa_template_lang text,
  add column if not exists wa_params jsonb,
  add column if not exists delivery text check (delivery is null or delivery in ('sent', 'delivered', 'read', 'failed'));
create index if not exists crm_sequence_sends_provider_idx on crm_sequence_sends (provider_id) where provider_id is not null;

create or replace function crm_whatsapp_connected(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select company_can(p_company, 'whatsapp_api')
     and exists (select 1 from company_whatsapp w where w.company_id = p_company and w.status = 'connected')
$$;
revoke all on function crm_whatsapp_connected(uuid) from public, anon;
grant execute on function crm_whatsapp_connected(uuid) to authenticated, service_role;

-- May this lead get this WhatsApp message without a person? WhatsApp lets a
-- business write first only with an approved template; free text only in the
-- 24 hours after the client last wrote.
create or replace function crm_whatsapp_can_send(p_company uuid, p_lead uuid, p_has_template boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select crm_whatsapp_connected(p_company)
     and (p_has_template or exists (
           select 1 from crm_activities a
            where a.lead_id = p_lead and a.type = 'whatsapp' and a.direction = 'in'
              and coalesce(a.started_at, a.created_at) > now() - interval '24 hours'))
$$;
revoke all on function crm_whatsapp_can_send(uuid, uuid, boolean) from public, anon;
grant execute on function crm_whatsapp_can_send(uuid, uuid, boolean) to authenticated, service_role;

-- 0202's, now knowing about WhatsApp.
create or replace function crm_sequence_can_auto(p_company uuid, p_channel text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_channel
           when 'email' then company_can(p_company, 'sequences_auto')
           when 'whatsapp' then crm_whatsapp_connected(p_company)
           else false
         end
$$;

-- A message to the studio's number. A number we know goes on that lead's
-- timeline (the most recent open one); a new number is a new enquiry. The
-- activity insert does the rest (0202): contacted, sequence stopped on reply.
-- Meta retries, so a message id seen before is ignored.
create or replace function crm_whatsapp_inbound(
  p_phone_number_id text, p_from text, p_name text, p_body text, p_wamid text, p_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_norm    text := crm_normalize_phone(p_from);
  v_lead    crm_leads;
  v_created boolean := false;
  v_act     uuid;
  v_to      uuid;
begin
  select company_id into v_company from company_whatsapp where phone_number_id = p_phone_number_id;
  if v_company is null or v_norm is null then
    return jsonb_build_object('matched', false);
  end if;
  if p_wamid is not null and exists (
    select 1 from crm_activities where company_id = v_company and provider = 'whatsapp' and external_id = p_wamid
  ) then
    return jsonb_build_object('matched', true, 'duplicate', true);
  end if;

  select * into v_lead from crm_leads
   where company_id = v_company and phone_norm = v_norm and merged_into is null
   order by (status not in ('converted', 'lost') and not is_archived) desc, created_at desc
   limit 1;
  if not found then
    insert into crm_leads (company_id, name, phone, source)
    values (v_company, coalesce(nullif(trim(p_name), ''), '+' || v_norm), '+' || v_norm, 'whatsapp')
    returning * into v_lead;
    v_created := true;
  end if;

  insert into crm_activities (company_id, lead_id, type, direction, subject, body, provider, external_id, started_at)
  values (v_company, v_lead.id, 'whatsapp', 'in', 'WhatsApp message', left(coalesce(p_body, ''), 4000), 'whatsapp', p_wamid, coalesce(p_at, now()))
  returning id into v_act;

  v_to := crm_alert_recipient(v_company, v_lead.assigned_to);
  if v_to is not null then
    perform create_notification(
      v_company, v_to, 'crm_whatsapp_in',
      coalesce(v_lead.name, '+' || v_norm) || case when v_created then ' messaged you on WhatsApp' else ' replied on WhatsApp' end,
      left(coalesce(p_body, ''), 140),
      'wa-in:' || coalesce(p_wamid, v_act::text),
      'crm_lead', v_lead.id);
  end if;
  return jsonb_build_object('matched', true, 'lead_id', v_lead.id, 'created', v_created);
end;
$$;
revoke all on function crm_whatsapp_inbound(text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function crm_whatsapp_inbound(text, text, text, text, text, timestamptz) to service_role;

-- A delivery receipt for a message a sequence sent.
create or replace function crm_whatsapp_receipt(p_wamid text, p_status text, p_error text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with u as (
    update crm_sequence_sends
       set delivery = p_status,
           status = case when p_status = 'failed' then 'failed' else status end,
           error = case when p_status = 'failed' then coalesce(p_error, 'WhatsApp could not deliver it') else error end
     where provider_id = p_wamid and channel = 'whatsapp'
       -- a later receipt never goes backwards (read, then a late "delivered")
       and coalesce(array_position(array['sent', 'delivered', 'read'], delivery), 0)
           < coalesce(array_position(array['sent', 'delivered', 'read'], p_status), 99)
    returning 1)
  select exists (select 1 from u)
$$;
revoke all on function crm_whatsapp_receipt(text, text, text) from public, anon, authenticated;
grant execute on function crm_whatsapp_receipt(text, text, text) to service_role;

-- A reply (a message or a call in) also drops what the lead's sequences
-- still had waiting to send -- "still deciding?" after they wrote back reads
-- as not listening. 0202 only dropped it for a sequence still running; a
-- finished one could leave its last message sitting in Send now.
create or replace function crm_activities_drop_waiting_on_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_id is null or new.direction <> 'in' or new.type not in ('whatsapp', 'email', 'sms', 'call') then
    return null;
  end if;
  update crm_sequence_sends s
     set status = 'skipped', error = 'They replied'
    from crm_cadences c
   where s.lead_id = new.lead_id and c.id = s.cadence_id and c.stop_on_reply
     and s.status in ('manual', 'queued');
  return null;
end;
$$;
drop trigger if exists crm_activities_zz_drop_waiting on crm_activities;
create trigger crm_activities_zz_drop_waiting after insert on crm_activities
  for each row execute function crm_activities_drop_waiting_on_reply();

-- ── The hourly sweep ─────────────────────────────────────────
-- 0202's body. A WhatsApp step is queued for the API when the studio's
-- number is connected and WhatsApp allows it (a template, or the client's
-- open 24 hours); the template and its words travel with the message.
create or replace function crm_advance_cadences(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_next crm_cadence_steps;
  v_due int := 0;
  v_advanced int := 0;
  v_completed int := 0;
  v_written int := 0;
  v_next_at timestamptz;
  v_body text;
  v_to uuid;
  v_text text;
  v_status text;
  v_error text;
begin
  for v_r in
    select lc.lead_id, lc.company_id, lc.cadence_id, lc.step_no, lc.started_at,
           c.name as cadence_name, s.note, s.template_id, t.name as template_name,
           s.channel, s.subject, s.body as step_body, t.body as template_body,
           s.wa_template_name, s.wa_template_lang, s.wa_params,
           l.assigned_to, l.name as lead_name, l.phone, l.email
    from crm_lead_cadences lc
    join crm_cadences c on c.id = lc.cadence_id
    join crm_cadence_steps s on s.cadence_id = lc.cadence_id and s.step_no = lc.step_no
    join crm_leads l on l.id = lc.lead_id
    left join crm_templates t on t.id = s.template_id
    where lc.completed_at is null and lc.stopped_at is null and lc.next_at <= now()
      and l.is_archived = false and l.status not in ('converted', 'lost')
  loop
    v_due := v_due + 1;
    if p_dry_run then continue; end if;

    v_text := coalesce(nullif(trim(v_r.step_body), ''), v_r.template_body);
    v_to := crm_alert_recipient(v_r.company_id, v_r.assigned_to);

    if v_r.channel in ('whatsapp', 'email') and v_text is not null then
      v_error := case
                   when v_r.channel = 'whatsapp' and v_r.phone is null then 'No phone number'
                   when v_r.channel = 'email' and v_r.email is null then 'No email address'
                 end;
      v_status := case
                    when v_error is not null then 'skipped'
                    when v_r.channel = 'email' and crm_sequence_can_auto(v_r.company_id, 'email') then 'queued'
                    when v_r.channel = 'whatsapp' and crm_whatsapp_can_send(v_r.company_id, v_r.lead_id, v_r.wa_template_name is not null) then 'queued'
                    else 'manual'
                  end;
      insert into crm_sequence_sends (company_id, lead_id, cadence_id, step_no, enrolled_at, channel, subject, body, status, error,
                                      wa_template_name, wa_template_lang, wa_params)
      values (v_r.company_id, v_r.lead_id, v_r.cadence_id, v_r.step_no, v_r.started_at, v_r.channel,
              v_r.subject, v_text, v_status, v_error,
              case when v_r.channel = 'whatsapp' then v_r.wa_template_name end,
              case when v_r.channel = 'whatsapp' then v_r.wa_template_lang end,
              case when v_r.channel = 'whatsapp' then v_r.wa_params end)
      on conflict (lead_id, cadence_id, step_no, enrolled_at) do nothing;
      if found then v_written := v_written + 1; end if;

      if v_status = 'manual' and v_to is not null then
        perform create_notification(
          v_r.company_id, v_to, 'crm_sequence_send',
          'Send ' || case when v_r.channel = 'whatsapp' then 'WhatsApp' else 'email' end
            || ' to ' || coalesce(v_r.lead_name, v_r.phone, 'lead'),
          left(v_text, 140),
          'seqsend:' || v_r.lead_id::text || ':' || v_r.step_no::text || ':' || extract(epoch from v_r.started_at)::bigint::text,
          'crm_lead', v_r.lead_id);
      end if;
      insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
      values (v_r.company_id, v_r.lead_id, null, null, null,
              v_r.cadence_name || ' step ' || v_r.step_no || ': '
              || case v_status when 'queued' then v_r.channel || ' sending'
                               when 'manual' then v_r.channel || ' ready to send'
                               else v_r.channel || ' skipped (' || v_error || ')' end);
    else
      v_body := coalesce(v_r.note, '') || case when v_r.template_name is not null then ' · send "' || v_r.template_name || '"' else '' end;
      if v_to is not null then
        perform create_notification(
          v_r.company_id, v_to, 'crm_cadence',
          v_r.cadence_name || ' step ' || v_r.step_no || ': ' || coalesce(v_r.lead_name, v_r.phone, 'lead'),
          nullif(trim(v_body), ''),
          'cadence:' || v_r.lead_id::text || ':' || v_r.step_no::text,
          'crm_lead', v_r.lead_id);
      end if;
      insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
      values (v_r.company_id, v_r.lead_id, null, null, null,
              'cadence step ' || v_r.step_no || ' due' || case when v_r.note is not null then ': ' || v_r.note else '' end);
    end if;

    select * into v_next from crm_cadence_steps
     where cadence_id = v_r.cadence_id and step_no > v_r.step_no order by step_no limit 1;
    if found then
      v_next_at := greatest(crm_sequence_step_at(v_r.started_at, v_next.day_offset, v_next.send_hour), now() + interval '1 hour');
      update crm_lead_cadences set step_no = v_next.step_no, next_at = v_next_at where lead_id = v_r.lead_id;
      if v_next.channel = 'reminder' then
        update crm_leads set follow_up_at = v_next_at where id = v_r.lead_id;
      end if;
      v_advanced := v_advanced + 1;
    else
      update crm_lead_cadences set completed_at = now(), next_at = null where lead_id = v_r.lead_id;
      v_completed := v_completed + 1;
    end if;
  end loop;
  return jsonb_build_object('due', v_due, 'advanced', v_advanced, 'completed', v_completed, 'messages', v_written);
end;
$$;
revoke all on function crm_advance_cadences(boolean) from public, anon;
grant execute on function crm_advance_cadences(boolean) to service_role;