-- 0251: expected guests on every event; the client's page stops showing
-- unchecked hand-ins as "ready"; the delivery page stops showing the editor's
-- private hand-in notes.
--
-- 1. Guests. A function is planned by how many people come: ~400 at the
--    wedding needs two cameras, 60 at the haldi needs one. One number on the
--    shoot (and on a lead's event, so it rides into the shoot on booking).
--
-- 2. The client portal (0184) called every deliverable in 'review' "ready"
--    and handed the client its link -- including work still With manager,
--    which nobody in the studio has checked yet. Review now reads "ready"
--    only once the studio approved it or sent it (Approved, With client,
--    Client approved; a review row with no stage code is the pre-0166 "with
--    client"); anything else in review is still "in progress" to the client,
--    and the link is held back until it is ready.
--
-- 3. get_delivery_for_token (0126) returned the hand-in's notes -- the
--    editor's words to the manager ("colour on reel 2 still off") -- to the
--    client's delivery page. It returns null there now; the column stays so
--    the API's shape does not change.
--
-- 4. The client's details form (0244) asks for guests per event too;
--    client_details_submit is copied from 0244 with only the shoots insert
--    changed. Copy it from here from now on.

-- ── 1. guests ────────────────────────────────────────────────────
alter table shoots add column if not exists guests int
  check (guests is null or guests between 1 and 100000);
alter table crm_lead_functions add column if not exists guests int
  check (guests is null or guests between 1 and 100000);

-- ── 2. what the client reads as ready ────────────────────────────
drop function if exists client_portal_status(text);
create or replace function client_portal_status(p_status text, p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when p_status = 'completed' then 'ready'
           when p_status = 'review' and coalesce(p_code, 'with_client') in ('approved', 'with_client', 'client_approved') then 'ready'
           when p_status in ('in_progress', 'review') then 'in_progress'
           else 'not_started'
         end
$$;

-- The whole page. Counts the view.
create or replace function get_client_portal(p_raw text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_link client_portal_links;
  v_out jsonb;
  v_received numeric;
begin
  v_link := client_portal_link_for_token(p_raw);
  if v_link.id is null then
    return null;
  end if;

  select coalesce(sum(rp.amount), 0) into v_received
    from received_payments rp
   where rp.project_id = v_link.project_id and rp.company_id = v_link.company_id
     and coalesce(rp.status, 'paid') = 'paid';

  select jsonb_build_object(
    'studio', jsonb_build_object(
      'name', coalesce(co.display_name, co.name),
      'logo_url', coalesce(th.logo_url, co.invoice_logo_url, co.avatar_url),
      'phone', co.invoice_phone,
      'email', co.invoice_email,
      'website', co.website,
      'city', co.city,
      'brand_color', case when th.is_custom_theme then coalesce(th.primary_color, th.custom_color) end,
      'theme_preset', th.preset_key
    ),
    'project', jsonb_build_object(
      'name', p.name,
      'client_name', cl.name,
      'status', p.status
    ),
    'options', jsonb_build_object(
      'show_payments', v_link.show_payments,
      'allow_feedback', v_link.allow_feedback,
      'expires_at', v_link.expires_at
    ),
    'shoots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'shoot_date', s.shoot_date,
               'start_at', s.start_at, 'end_at', s.end_at, 'guests', s.guests,
               'location', s.location, 'map_link', s.map_link,
               'status', s.status,
               'team', case when v_link.show_team then coalesce((
                 select jsonb_agg(jsonb_build_object('first_name', t.first_name, 'role', t.role)
                                  order by t.role nulls last, t.first_name)
                   from (
                     select distinct split_part(trim(u.name), ' ', 1) as first_name,
                            nullif(trim(x.service_name), '') as role
                       from (
                         select ts.user_id, ts.service_name from team_assignment_slots ts
                          where ts.shoot_id = s.id and ts.company_id = s.company_id and ts.status = 'booked'
                         union
                         select sa.user_id, sa.service_name from shoot_assignments sa
                          where sa.shoot_id = s.id and sa.company_id = s.company_id and sa.status <> 'declined'
                       ) x
                       join users u on u.user_id = x.user_id and u.company_id = s.company_id
                      where u.deleted_at is null
                   ) t), '[]'::jsonb) else '[]'::jsonb end
             ) order by s.shoot_date nulls last, s.start_at nulls last, s.created_at)
        from shoots s
       where s.project_id = p.id and s.company_id = p.company_id and s.status <> 'cancelled'), '[]'::jsonb),
    'deliverables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', d.title, 'description', d.description,
               'status', client_portal_status(d.status, d.custom_status_code),
               'expected_date', d.estimated_date,
               'delivered_at', d.delivered_at,
               'delivery_link', case when client_portal_status(d.status, d.custom_status_code) = 'ready'
                                   then nullif(trim(d.delivery_link), '') end,
               'shoot_name', (select s.name from shoots s where s.id = d.shoot_id and s.company_id = d.company_id),
               'feedback', (
                 select jsonb_build_object('kind', f.kind, 'message', f.message, 'created_at', f.created_at)
                   from client_portal_feedback f
                  where f.deliverable_id = d.id and f.company_id = d.company_id
                  order by f.created_at desc limit 1)
             ) order by d.estimated_date nulls last, d.created_at)
        from deliverables d
       where d.project_id = p.id and d.company_id = p.company_id
         and d.visibility_scope = 'client'
         and coalesce(d.show_on_quotation, true)
         and d.status <> 'cancelled'), '[]'::jsonb),
    'money', case when v_link.show_payments then jsonb_build_object(
      'total', coalesce(p.total_cost, 0),
      'received', v_received,
      'balance', greatest(coalesce(p.total_cost, 0) - v_received, 0),
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', i.id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date,
                 'due_date', i.due_date, 'status', i.status, 'total', i.total,
                 'balance_due', i.balance_due) order by i.invoice_date, i.created_at)
          from invoices i
         where i.project_id = p.id and i.company_id = p.company_id
           and i.status not in ('draft', 'cancelled')), '[]'::jsonb)
    ) end,
    'terms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', coalesce(d.title, 'Terms & agreement'),
               'sent_at', coalesce(d.sent_at, d.created_at),
               'agreed_at', d.acknowledged_at, 'agreed_by', d.acknowledged_by_name)
             order by coalesce(d.sent_at, d.created_at) desc)
        from project_terms_documents d
       where d.project_id = p.id and d.company_id = p.company_id
         and d.revoked_at is null and not d.is_draft
         and (d.sent_at is not null or d.acknowledged_at is not null)), '[]'::jsonb)
  ) into v_out
    from projects p
    join companies co on co.id = p.company_id
    left join company_theme_settings th on th.company_id = p.company_id
    left join clients cl on cl.id = p.client_id and cl.company_id = p.company_id
   where p.id = v_link.project_id and p.company_id = v_link.company_id;

  if v_out is not null then
    update client_portal_links
       set view_count = view_count + 1, last_viewed_at = now()
     where id = v_link.id;
  end if;
  return v_out;
end;
$$;
revoke all on function get_client_portal(text) from public, anon, authenticated;
grant execute on function get_client_portal(text) to service_role;

-- ── 3. the delivery page without the editor's notes ──────────────
create or replace function get_delivery_for_token(p_raw text)
returns table (
  submission_link text, notes text, delivered_at timestamptz,
  project_name text, client_name text, company_name text,
  title text, delivery_type text, delivery_label text, logo_url text,
  ready_at timestamptz, revoked boolean, expires_at timestamptz, access_count int,
  company_legal_name text, company_website text, document_footer_note text,
  company_phone text, company_email text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_sub uuid;
  v_expires timestamptz;
begin
  select at.subject_id, at.expires_at into v_sub, v_expires
    from access_tokens at
   where at.purpose = 'work_delivery'
     and at.token_hash = v_hash
     and (at.expires_at is null or at.expires_at > now())
     and at.revoked_at is null
   limit 1;
  if v_sub is null then
    return;
  end if;

  update access_tokens at set access_count = coalesce(at.access_count, 0) + 1
   where at.purpose = 'work_delivery' and at.token_hash = v_hash;
  update team_work_submissions s set access_count = coalesce(s.access_count, 0) + 1
   where s.id = v_sub;

  return query
  select s.submission_link, null::text,
         (select max(d.delivered_at) from team_work_client_deliveries d
           where d.submission_id = s.id and d.revoked_at is null),
         p.name, cl.name, coalesce(co.display_name, co.name),
         s.title, s.delivery_type, s.delivery_label,
         coalesce(co.invoice_logo_url, co.avatar_url),
         s.ready_at, (s.revoked_at is not null), v_expires,
         coalesce(s.access_count, 0),
         co.legal_name, co.website, co.document_footer_note,
         co.invoice_phone, co.invoice_email
    from team_work_submissions s
    left join projects p on p.id = s.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = s.company_id
   where s.id = v_sub
     and s.status in ('submitted', 'approved', 'sent')
     and s.revoked_at is null;
end;
$$;
revoke all on function get_delivery_for_token(text) from public;
grant execute on function get_delivery_for_token(text) to anon, authenticated;

-- ── 4. the client's details form carries guests (copied from 0244) ──
-- Only the shoots insert changed: an event's "guests" lands on its day.
create or replace function client_details_submit(p_raw text, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_link     client_detail_links;
  v_name     text := left(btrim(coalesce(p_payload ->> 'name', '')), 120);
  v_partner  text := left(btrim(coalesce(p_payload ->> 'partner_name', '')), 120);
  v_phone    text := left(btrim(coalesce(p_payload ->> 'phone', '')), 30);
  v_pphone   text := left(btrim(coalesce(p_payload ->> 'partner_phone', '')), 30);
  v_email    text := left(lower(btrim(coalesce(p_payload ->> 'email', ''))), 200);
  v_address  text := left(btrim(coalesce(p_payload ->> 'address', '')), 500);
  v_city     text := left(btrim(coalesce(p_payload ->> 'city', '')), 120);
  v_occasion text := left(coalesce(nullif(btrim(p_payload ->> 'occasion'), ''), 'Wedding'), 60);
  v_digits   text;
  v_client   uuid;
  v_project  uuid;
  v_made     boolean := false;
  v_held     text;
  v_has_days boolean;
  v_added    int := 0;
  v_waiting  int := 0;
  v_ev       jsonb;
  v_date     date;
  v_start    timestamptz;
  v_hours    numeric;
  v_sub      uuid;
  v_who      uuid;
  v_first    text;
  v_pfirst   text;
  v_title    text;
  v_body     text;
begin
  v_link := client_details_link_for(p_raw);
  if v_link.id is null then
    raise exception 'This link is not working any more.' using errcode = 'P0002';
  end if;
  if v_name = '' then
    raise exception 'Please add your name.' using errcode = '22023';
  end if;
  if v_link.project_id is null and v_phone = '' then
    raise exception 'Please add your phone number.' using errcode = '22023';
  end if;
  v_first := split_part(v_name, ' ', 1);
  v_pfirst := nullif(split_part(v_partner, ' ', 1), '');

  -- ── the client ──
  if v_link.project_id is not null then
    select client_id into v_client from projects where id = v_link.project_id;
    v_project := v_link.project_id;
  else
    v_digits := right(regexp_replace(v_phone, '\D', '', 'g'), 10);
    if length(v_digits) = 10 then
      select id into v_client from clients
       where company_id = v_link.company_id
         and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_digits
       order by created_at
       limit 1;
    end if;
    if v_client is null then
      insert into clients (company_id, name, phone, created_by)
      values (v_link.company_id, v_name, nullif(v_phone, ''), v_link.created_by)
      returning id into v_client;
    end if;
  end if;

  update clients
     set phone           = coalesce(nullif(btrim(phone), ''), nullif(v_phone, '')),
         alternate_phone = coalesce(nullif(btrim(alternate_phone), ''), nullif(v_pphone, '')),
         email           = coalesce(nullif(btrim(email), ''), nullif(v_email, '')),
         address         = coalesce(nullif(btrim(address), ''), nullif(v_address, '')),
         city            = coalesce(nullif(btrim(city), ''), nullif(v_city, '')),
         notes           = case when v_partner <> '' and coalesce(notes, '') not ilike '%' || v_partner || '%'
                                then left(concat_ws(E'\n', nullif(btrim(notes), ''), 'Partner: ' || v_partner), 4000)
                                else notes end
   where id = v_client;

  -- ── the project (studio form only) ──
  if v_project is null then
    begin
      insert into projects (company_id, client_id, name, created_by)
      values (v_link.company_id, v_client,
              left(coalesce(v_first || coalesce(' & ' || v_pfirst, ''), v_name) || '''s ' || v_occasion, 120),
              v_link.created_by)
      returning id into v_project;
      v_made := true;
    exception when sqlstate '54000' then
      v_held := sqlerrm;
      v_project := null;
    end;
  end if;

  -- ── the dates ──
  perform client_details_put_occasion(v_link.company_id, v_client, v_project, 'birthday', v_first, p_payload -> 'birthday');
  if v_pfirst is not null then
    perform client_details_put_occasion(v_link.company_id, v_client, v_project, 'birthday', v_pfirst, p_payload -> 'partner_birthday');
  end if;
  perform client_details_put_occasion(v_link.company_id, v_client, v_project, 'anniversary', '', p_payload -> 'wedding');

  -- ── the events ──
  if v_project is not null then
    select exists (select 1 from shoots where project_id = v_project and status <> 'cancelled') into v_has_days;
    for v_ev in select e from jsonb_array_elements(coalesce(p_payload -> 'events', '[]'::jsonb)) e limit 12 loop
      continue when nullif(btrim(v_ev ->> 'name'), '') is null;
      if v_has_days then
        -- The studio has its plan; this one waits unless it is already there.
        if not exists (
          select 1 from shoots s where s.project_id = v_project and s.status <> 'cancelled'
             and lower(btrim(s.name)) = lower(btrim(v_ev ->> 'name'))
             and s.shoot_date is not distinct from nullif(v_ev ->> 'date', '')::date) then
          v_waiting := v_waiting + 1;
        end if;
        continue;
      end if;
      v_date := nullif(v_ev ->> 'date', '')::date;
      v_hours := least(greatest(nullif(v_ev ->> 'hours', '')::numeric, 0.5), 24);
      v_start := case when v_date is not null and (v_ev ->> 'start_time') ~ '^\d{1,2}:\d{2}$'
                      then (v_date + (v_ev ->> 'start_time')::time) at time zone 'Asia/Kolkata' end;
      insert into shoots (company_id, project_id, name, shoot_date, start_at, end_at, location, guests)
      values (v_link.company_id, v_project, left(btrim(v_ev ->> 'name'), 80), v_date, v_start,
              case when v_start is not null and v_hours is not null then v_start + make_interval(secs => v_hours * 3600) end,
              left(nullif(btrim(v_ev ->> 'venue'), ''), 300),
              case when (v_ev ->> 'guests') ~ '^\d{1,6}$' and (v_ev ->> 'guests')::int between 1 and 100000
                   then (v_ev ->> 'guests')::int end);
      v_added := v_added + 1;
    end loop;
  end if;

  insert into client_detail_submissions (company_id, link_id, client_id, project_id, payload, held_reason)
  values (v_link.company_id, v_link.id, v_client, v_project, p_payload, v_held)
  returning id into v_sub;
  update client_detail_links
     set last_submitted_at = now(), submit_count = submit_count + 1
   where id = v_link.id;

  -- ── the bell: the owner, whoever sent the link, whoever made the project ──
  v_title := v_name || ' sent their details';
  v_body := case
    when v_held is not null then 'Saved as a client. No project was made: ' || v_held
    when v_made and v_added > 0 then 'New project · ' || v_added || case when v_added = 1 then ' day added' else ' days added' end
    when v_made then 'New project from the client form'
    when v_waiting > 0 then v_waiting || case when v_waiting = 1 then ' event to add' else ' events to add' end || ' on the Shoots tab'
    when v_added > 0 then v_added || case when v_added = 1 then ' day added' else ' days added' end
    else 'Their details and dates are saved' end;
  for v_who in
    select distinct u from (
      select owner_user_id as u from companies where id = v_link.company_id
      union select v_link.created_by
      union select created_by from projects where id = v_project
    ) w
    where u is not null and exists (select 1 from users where user_id = u and company_id = v_link.company_id)
  loop
    perform create_notification(
      v_link.company_id, v_who, 'client_details', v_title, v_body,
      'client_details:' || v_sub || ':' || v_who,
      case when v_project is not null then 'project' else 'client' end,
      coalesce(v_project, v_client),
      case when v_held is not null then 'warning' else 'info' end,
      case when v_project is not null then '/projects/' || v_project || '?tab=' ||
                case when v_waiting > 0 or v_added > 0 then 'shoots' else 'wishes' end
           else '/clients' end,
      '{}'::jsonb);
  end loop;

  return jsonb_build_object(
    'client_id', v_client, 'project_id', v_project, 'project_made', v_made,
    'days_added', v_added, 'events_waiting', v_waiting, 'held', v_held is not null);
end;
$$;
revoke all on function client_details_submit(text, jsonb) from public, anon, authenticated;
grant execute on function client_details_submit(text, jsonb) to service_role;
