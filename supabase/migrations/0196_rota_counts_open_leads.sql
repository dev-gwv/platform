-- The rota hands leads to whoever is carrying least — and now it means it.
--
-- ── the bug ───────────────────────────────────────────────────
-- Three functions pick an assignee: capture_lead (0107), add_lead (0028) and
-- crm_import_leads (0156). All three ordered the rota by
--
--     select count(*) from crm_leads l where l.assigned_to = r.user_id
--
-- every lead that member has EVER held: converted, lost and archived included.
-- So the longer someone works here the less work they are given, until a rep
-- with a year of closed business never receives another lead and a new hire
-- receives all of them. Nothing errors. Nothing looks wrong.
--
-- What makes it worse is that the screen already disagreed with the database.
-- GET /crm/distribution counts open, unarchived leads and prints "N open", and
-- the line above the list reads "New unassigned leads go to the active member
-- with fewest open leads". The sentence was true of the UI and false of the
-- assignment. A studio could watch one rep sit at 2 open and another at 40 and
-- see the next lead go to the one with 40.
--
-- Open now means what it means everywhere else in this schema (0032, 0035):
-- is_archived = false and status not in ('converted', 'lost').
--
-- ── and the strategy column stops pretending ──────────────────
-- crm_distribution_rules.strategy has accepted 'round_robin' since 0099 and
-- DistributionTab has hard-coded exactly that on every add, while no SQL ever
-- read the column. assigned_count and last_assigned_at were never written
-- either. A setting that does nothing is worse than no setting, because someone
-- eventually relies on it.
--
-- The algorithm is a decision about the whole desk, not about one member, so it
-- belongs on crm_settings next to sla_hours rather than on each rota row. The
-- per-row column stays for now: another session works this repo daily and
-- dropping a column out from under it is not worth the tidiness.

alter table crm_settings add column if not exists assign_strategy text not null default 'least_loaded'
  check (assign_strategy in ('least_loaded', 'round_robin'));

-- ── one definition of "who is next" ───────────────────────────
-- Extracted so the three callers cannot drift apart again, which is how they
-- came to share a bug in the first place.
--
-- It writes as well as reads: round-robin is only meaningful if the turn is
-- recorded, and assigned_count is the only history of distribution this schema
-- has. Called inside crm_import_leads' row loop, that makes a CSV rotate
-- properly across the rota instead of landing entirely on one person.
create or replace function crm_pick_assignee(p_company uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_strategy text;
  v_user     uuid;
begin
  if p_company is null then return null; end if;

  select s.assign_strategy into v_strategy
    from crm_settings s where s.company_id = p_company;
  -- A studio that has never opened the settings screen has no row yet.
  v_strategy := coalesce(v_strategy, 'least_loaded');

  if v_strategy = 'round_robin' then
    -- Longest since their last turn. Nulls first so a member added to the rota
    -- today gets a lead before anyone repeats.
    --
    -- The stamp below is clock_timestamp(), not now(): now() is fixed for the
    -- whole transaction, so a 200-row CSV import would write one identical
    -- timestamp to every member it picked and this ordering could not tell who
    -- had just had a turn. Three of four leads then landed on the same person.
    select r.user_id into v_user
      from crm_distribution_rules r
      where r.company_id = p_company and r.is_active
      order by r.last_assigned_at asc nulls first, r.priority asc, r.user_id
      limit 1;
  else
    select r.user_id into v_user
      from crm_distribution_rules r
      where r.company_id = p_company and r.is_active
      order by (
        select count(*) from crm_leads l
         where l.company_id = p_company
           and l.assigned_to = r.user_id
           and l.is_archived = false
           and l.status not in ('converted', 'lost')
      ) asc, r.priority asc, r.user_id
      limit 1;
  end if;

  if v_user is not null then
    update crm_distribution_rules
       set last_assigned_at = clock_timestamp(),
           assigned_count   = coalesce(assigned_count, 0) + 1
     where company_id = p_company and user_id = v_user;
  end if;

  return v_user;
end;
$$;

revoke all on function crm_pick_assignee(uuid) from public, anon, authenticated;

-- ── the three callers, otherwise unchanged ────────────────────
-- Each body below is its latest definition copied verbatim -- capture_lead
-- from 0107, add_lead from 0028, crm_import_leads from 0156 -- with only the
-- rota block replaced by the call above. Rebuilding a body from an older
-- migration is how the picklists went backwards in 0139.

create or replace function capture_lead(
  p_source_key text,
  p_name       text,
  p_phone      text,
  p_email      text default null,
  p_meta       jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source   crm_webhook_sources;
  v_norm     text := crm_normalize_phone(p_phone);
  v_existing uuid;
  v_assignee uuid;
  v_lead     uuid;
  v_default_pipeline uuid;
  v_stage    uuid;
begin
  select * into v_source from crm_webhook_sources
    where source_key = p_source_key and is_active;
  if not found then
    raise exception 'unknown or inactive source' using errcode = '42501';
  end if;

  update crm_webhook_sources set last_received_at = now() where id = v_source.id;

  if v_norm is not null then
    select id into v_existing from crm_leads
      where company_id = v_source.company_id and phone_norm = v_norm
      limit 1;
    if found then return v_existing; end if;
  end if;

  -- Per-source default assignee wins; otherwise the rota decides (0196).
  v_assignee := v_source.default_assigned_to;
  if v_assignee is null then
    v_assignee := crm_pick_assignee(v_source.company_id);
  end if;

  insert into crm_leads (
    company_id, name, phone, phone_norm, email, source, source_key, assigned_to, source_meta, quality
  )
  values (
    v_source.company_id, p_name, p_phone, v_norm, p_email,
    coalesce(v_source.default_source, case when v_source.kind = 'meta' then 'facebook' else 'webform' end),
    v_source.source_key, v_assignee, coalesce(p_meta, '{}'::jsonb),
    v_source.default_quality
  )
  returning id into v_lead;

  -- Per-source default stage (a legacy status key like 'contacted').
  if v_source.default_stage is not null then
    select id into v_default_pipeline from crm_pipelines
     where company_id = v_source.company_id and is_default;
    if v_default_pipeline is not null then
      v_stage := crm_stage_for_status(v_default_pipeline, v_source.default_stage);
      if v_stage is not null then
        update crm_leads set stage_id = v_stage where id = v_lead;
      end if;
    end if;
  end if;

  return v_lead;
end;
$$;

create or replace function add_lead(
  p_name    text,
  p_phone   text,
  p_email   text default null,
  p_source  text default 'manual',
  p_notes   text default null,
  p_assign  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := get_current_company_id();
  v_norm     text := crm_normalize_phone(p_phone);
  v_existing uuid;
  v_assignee uuid := p_assign;
  v_lead     uuid;
begin
  if v_company is null then
    raise exception 'no company in scope' using errcode = '42501';
  end if;

  -- Same number, same studio: hand back the lead that already exists rather
  -- than splitting one client's history across two rows.
  if v_norm is not null then
    select id into v_existing from crm_leads
      where company_id = v_company and phone_norm = v_norm
      limit 1;
    if found then return v_existing; end if;
  end if;

  -- Unassigned: the rota decides who is carrying least, or whose turn it is (0196).
  if v_assignee is null then
    v_assignee := crm_pick_assignee(v_company);
  end if;

  insert into crm_leads (company_id, name, phone, phone_norm, email, source, notes, assigned_to)
  values (v_company, p_name, p_phone, v_norm, p_email, p_source, p_notes, v_assignee)
  returning id into v_lead;

  return v_lead;
end;
$$;

create or replace function crm_import_leads(p_rows jsonb, p_skip_duplicates boolean default true, p_mode text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := get_current_company_id();
  v_mode     text := coalesce(nullif(p_mode, ''), case when p_skip_duplicates then 'skip' else 'create' end);
  v_row      jsonb;
  v_idx      int := 0;
  v_norm     text;
  v_email    text;
  v_existing uuid;
  v_assignee uuid;
  v_id       uuid;
  v_created  int := 0;
  v_skipped  int := 0;
  v_updated  int := 0;
  v_invalid  int := 0;
  v_ids      uuid[] := '{}';
  v_errors   jsonb := '[]'::jsonb;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_mode not in ('skip', 'update', 'create') then
    raise exception 'unknown import mode' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'rows must be an array of at most 500' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    begin
      v_norm := crm_normalize_phone(v_row->>'phone');
      if v_norm is null then
        v_invalid := v_invalid + 1;
        v_errors := v_errors || jsonb_build_object('row', v_idx, 'error', 'Not a valid phone number');
        continue;
      end if;
      v_email := nullif(trim(coalesce(v_row->>'email', '')), '');

      select id into v_existing from crm_leads
        where company_id = v_company and phone_norm = v_norm and is_archived = false
        limit 1;

      if v_existing is not null and v_mode = 'skip' then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if v_existing is not null and v_mode = 'update' then
        update crm_leads set
          name = coalesce(nullif(v_row->>'name', ''), name),
          email = coalesce(v_email, email),
          notes = case when nullif(v_row->>'notes', '') is not null
                       then nullif(trim(coalesce(notes, '') || chr(10) || (v_row->>'notes')), '')
                       else notes end,
          city = coalesce(nullif(v_row->>'city', ''), city),
          event_type = coalesce(nullif(v_row->>'event_type', ''), event_type),
          event_date = coalesce(nullif(v_row->>'event_date', '')::date, event_date),
          event_location = coalesce(nullif(v_row->>'event_location', ''), event_location),
          deal_value = coalesce(nullif(v_row->>'deal_value', '')::numeric, deal_value),
          group_name = coalesce(nullif(v_row->>'group_name', ''), group_name),
          alternate_phone = coalesce(nullif(v_row->>'alternate_phone', ''), alternate_phone),
          quality = coalesce(nullif(v_row->>'quality', ''), quality)
        where id = v_existing;
        v_updated := v_updated + 1;
        continue;
      end if;

      v_assignee := nullif(v_row->>'assigned_to', '')::uuid;
      if v_assignee is null then
        v_assignee := crm_pick_assignee(v_company);
      end if;

      insert into crm_leads (company_id, name, phone, phone_norm, email, source, notes, assigned_to,
                             source_key, city, event_type, event_date, event_location,
                             deal_value, group_name, alternate_phone, quality)
      values (
        v_company,
        nullif(v_row->>'name', ''),
        v_row->>'phone',
        v_norm,
        v_email,
        coalesce(nullif(v_row->>'source', ''), 'manual'),
        nullif(v_row->>'notes', ''),
        v_assignee,
        'csv_import',
        nullif(v_row->>'city', ''),
        nullif(v_row->>'event_type', ''),
        nullif(v_row->>'event_date', '')::date,
        nullif(v_row->>'event_location', ''),
        nullif(v_row->>'deal_value', '')::numeric,
        nullif(v_row->>'group_name', ''),
        nullif(v_row->>'alternate_phone', ''),
        nullif(v_row->>'quality', '')
      )
      returning id into v_id;
      v_ids := v_ids || v_id;
      v_created := v_created + 1;
    exception when others then
      v_invalid := v_invalid + 1;
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'error', left(sqlerrm, 200));
    end;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'updated', v_updated,
                            'invalid', v_invalid, 'ids', to_jsonb(v_ids), 'errors', v_errors);
end;
$$;
