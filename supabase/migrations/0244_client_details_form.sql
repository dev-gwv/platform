-- 0244: the details form a client fills (Wishes, part 2).
--
-- The studio sends a link (or prints one QR); the client fills their own
-- name, phone, email, address, both birthdays, the wedding day and each event
-- of the function, and the studio's records fill themselves in.
--
--   * A project's link (one live per project): the raw token exists only in
--     the link; the row keeps its SHA-256, like the client portal (0184).
--   * The studio's form (one live per studio): a short public code, because
--     it is printed as a QR and shown again on Settings every visit. Each
--     form sent in makes a new client (or finds the same phone) and a
--     project, with its shoot days.
--
-- What the client sends never overwrites what the studio typed: client fields
-- fill only when blank, a date the studio set stays, and when the project
-- already has shoot days the client's events wait in the submission for the
-- studio to add (the Shoots tab's "From the client"). Nothing typed is lost
-- to a plan limit: when no project may be made (54000, 0242), the client and
-- the dates are still saved and the bell says why.

create table if not exists client_detail_links (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies (id) on delete cascade,
  -- Null for the studio's own form.
  project_id        uuid references projects (id) on delete cascade,
  token_hash        text unique check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  code              text unique check (code is null or code ~ '^[a-z0-9]{8,20}$'),
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  last_submitted_at timestamptz,
  submit_count      int not null default 0,
  -- A project's link is a hashed token; the studio's form is a code.
  check ((project_id is not null and token_hash is not null and code is null)
      or (project_id is null and code is not null and token_hash is null))
);
create unique index if not exists client_detail_links_project_live_idx
  on client_detail_links (project_id) where revoked_at is null and project_id is not null;
create unique index if not exists client_detail_links_studio_live_idx
  on client_detail_links (company_id) where revoked_at is null and project_id is null;

alter table client_detail_links enable row level security;
drop policy if exists client_detail_links_select on client_detail_links;
create policy client_detail_links_select on client_detail_links
  for select to authenticated using (company_id = get_current_company_id());
grant select on client_detail_links to authenticated;
grant select, insert, update on client_detail_links to service_role;

-- Every form sent in, as it was sent: the studio's record of what the client
-- said, and the events still to add.
create table if not exists client_detail_submissions (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  link_id    uuid references client_detail_links (id) on delete set null,
  client_id  uuid references clients (id) on delete set null,
  project_id uuid references projects (id) on delete set null,
  payload    jsonb not null,
  -- Why no project was made (the plan's words), when that happened.
  held_reason text,
  created_at timestamptz not null default now()
);
create index if not exists client_detail_submissions_project_idx
  on client_detail_submissions (company_id, project_id, created_at desc);

alter table client_detail_submissions enable row level security;
drop policy if exists client_detail_submissions_select on client_detail_submissions;
create policy client_detail_submissions_select on client_detail_submissions
  for select to authenticated using (company_id = get_current_company_id());
grant select on client_detail_submissions to authenticated;
grant select, insert on client_detail_submissions to service_role;

-- ── studio side ──────────────────────────────────────────────────
-- A new link for a project; the old one stops working. The API makes the raw
-- token and passes only its hash, and checks the permission.
create or replace function issue_client_details_link(p_project uuid, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from projects where id = p_project and company_id = v_company) then
    raise exception 'That project is not in this studio.' using errcode = 'P0002';
  end if;
  update client_detail_links set revoked_at = now()
   where project_id = p_project and company_id = v_company and revoked_at is null;
  insert into client_detail_links (company_id, project_id, token_hash, created_by)
  values (v_company, p_project, p_token_hash, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function issue_client_details_link(uuid, text) from public, anon;
grant execute on function issue_client_details_link(uuid, text) to authenticated;

-- The studio's own form code, made the first time; p_new retires the old one
-- (a QR that went somewhere it should not).
create or replace function client_details_studio_code(p_new boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_code text;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_new then
    update client_detail_links set revoked_at = now()
     where company_id = v_company and project_id is null and revoked_at is null;
  end if;
  select code into v_code from client_detail_links
   where company_id = v_company and project_id is null and revoked_at is null;
  if v_code is null then
    v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    insert into client_detail_links (company_id, code, created_by)
    values (v_company, v_code, auth.uid());
  end if;
  return v_code;
end;
$$;
revoke all on function client_details_studio_code(boolean) from public, anon;
grant execute on function client_details_studio_code(boolean) to authenticated;

-- ── the client's side (no session; the API calls these as the service) ──
create or replace function client_details_link_for(p_raw text)
returns client_detail_links
language sql
stable
security definer
set search_path = public
as $$
  select l.* from client_detail_links l
   where l.revoked_at is null
     and (l.token_hash = encode(sha256(convert_to(coalesce(p_raw, ''), 'UTF8')), 'hex')
          or (l.project_id is null and l.code = lower(coalesce(p_raw, ''))))
   limit 1
$$;
revoke all on function client_details_link_for(text) from public, anon, authenticated;
grant execute on function client_details_link_for(text) to service_role;

-- What the form shows: the studio's name and logo, and -- on a project's link
-- -- what is already known, so the client corrects instead of retyping.
create or replace function client_details_for_token(p_raw text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_link client_detail_links;
  v_client clients;
  v_project projects;
  v_studio jsonb;
begin
  v_link := client_details_link_for(p_raw);
  if v_link.id is null then
    return null;
  end if;

  select jsonb_build_object(
           'name', coalesce(nullif(btrim(co.display_name), ''), co.name),
           'logo_url', coalesce(nullif(co.invoice_logo_url, ''), nullif(co.avatar_url, '')),
           'phone', co.invoice_phone,
           'brand_color', case when th.is_custom_theme then coalesce(th.primary_color, th.custom_color) end)
    into v_studio
    from companies co
    left join company_theme_settings th on th.company_id = co.id
   where co.id = v_link.company_id;

  if v_link.project_id is null then
    return jsonb_build_object('kind', 'studio', 'studio', v_studio, 'project_name', null,
                              'submitted', false, 'prefill', null);
  end if;

  select * into v_project from projects where id = v_link.project_id;
  select * into v_client from clients where id = v_project.client_id;
  return jsonb_build_object(
    'kind', 'project',
    'studio', v_studio,
    'project_name', v_project.name,
    'submitted', v_link.submit_count > 0,
    'prefill', jsonb_build_object(
      'name', v_client.name,
      'phone', v_client.phone,
      'partner_phone', v_client.alternate_phone,
      'email', v_client.email,
      'address', v_client.address,
      'city', v_client.city,
      'occasions', coalesce((
        select jsonb_agg(jsonb_build_object('kind', o.kind, 'person_name', o.person_name,
                                            'day', o.day, 'month', o.month, 'year', o.year)
                         order by o.kind, o.person_name)
          from client_occasions o where o.client_id = v_client.id), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'name', s.name,
                 'date', s.shoot_date,
                 'start_time', to_char(s.start_at at time zone 'Asia/Kolkata', 'HH24:MI'),
                 'hours', case when s.start_at is not null and s.end_at is not null
                               then round(extract(epoch from s.end_at - s.start_at) / 3600.0, 1) end,
                 'venue', s.location)
               order by s.shoot_date nulls last, s.start_at nulls last)
          from shoots s where s.project_id = v_project.id and s.status <> 'cancelled'), '[]'::jsonb)
    ));
end;
$$;
revoke all on function client_details_for_token(text) from public, anon, authenticated;
grant execute on function client_details_for_token(text) to service_role;

-- Save one occasion from the form. The studio's own dates stay as they are.
create or replace function client_details_put_occasion(
  p_company uuid, p_client uuid, p_project uuid, p_kind text, p_person text, p_date jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day int := nullif(p_date ->> 'day', '')::int;
  v_month int := nullif(p_date ->> 'month', '')::int;
  v_year int := nullif(p_date ->> 'year', '')::int;
begin
  if p_date is null or v_day is null or v_month is null then
    return;
  end if;
  if v_month not between 1 and 12 or v_day not between 1 and 31
     or (v_month = 2 and v_day > 29) or (v_month in (4, 6, 9, 11) and v_day > 30) then
    return;
  end if;
  if v_year is not null and v_year not between 1900 and 2100 then
    v_year := null;
  end if;
  insert into client_occasions (company_id, client_id, project_id, kind, person_name, month, day, year, source)
  values (p_company, p_client, p_project, p_kind, left(coalesce(btrim(p_person), ''), 80), v_month, v_day, v_year, 'client_form')
  on conflict (client_id, kind, person_name) do update
     set month = excluded.month, day = excluded.day, year = excluded.year,
         source = 'client_form', project_id = coalesce(client_occasions.project_id, excluded.project_id)
   where client_occasions.source <> 'studio';
end;
$$;
revoke all on function client_details_put_occasion(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function client_details_put_occasion(uuid, uuid, uuid, text, text, jsonb) to service_role;

-- The form, sent in. The API has already checked its shape; this keeps the
-- rules: fill blanks, never overwrite the studio, never lose what was typed.
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
      insert into shoots (company_id, project_id, name, shoot_date, start_at, end_at, location)
      values (v_link.company_id, v_project, left(btrim(v_ev ->> 'name'), 80), v_date, v_start,
              case when v_start is not null and v_hours is not null then v_start + make_interval(secs => v_hours * 3600) end,
              left(nullif(btrim(v_ev ->> 'venue'), ''), 300));
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
