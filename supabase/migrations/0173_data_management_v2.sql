-- Data Management v2: every booked person's cards accounted for, from the
-- shoot day to the archive.
--
--   * Only admins and managers write data records, locations and helpers
--     (it was any active user). Crew see their own records only, and hand
--     their cards over through handover_slot_data(), which only touches the
--     caller's own booking.
--   * Custody trail: who received the cards, who verified, when the footage
--     went to the editor, and when (and where) it was archived. Archived is a
--     stage after the copies, derived like the others.
--   * A copy cannot be marked copied or verified without saying where it is.
--   * bulk_data_update(): one change (received / copied to / backed up to /
--     verified / handed to editor / archived) across many bookings at once,
--     creating the record for a booking that has none yet.
--   * run_data_reminder_cron(): every evening, crew still holding cards hear
--     about it, and managers get one digest of what is not safe yet. Both
--     repeat daily until the data moves, not once forever.

-- ── who can write ────────────────────────────────────────────────
drop policy if exists shoot_data_records_select on shoot_data_records;
drop policy if exists shoot_data_records_write on shoot_data_records;
create policy shoot_data_records_select on shoot_data_records
  for select to authenticated
  using (company_id = get_current_company_id() and (is_current_admin_or_manager() or user_id = auth.uid()));
create policy shoot_data_records_write on shoot_data_records
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager())
  with check (company_id = get_current_company_id() and is_current_admin_or_manager());

drop policy if exists storage_locations_write on storage_locations;
create policy storage_locations_write on storage_locations
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager())
  with check (company_id = get_current_company_id() and is_current_admin_or_manager());

drop policy if exists data_people_write on data_people;
create policy data_people_write on data_people
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager())
  with check (company_id = get_current_company_id() and is_current_admin_or_manager());

-- ── outside helpers ──────────────────────────────────────────────
alter table data_people
  add column if not exists role      text,
  add column if not exists phone     text,
  add column if not exists is_active boolean not null default true;

-- One name per studio, ignoring case -- unless old data already repeats one.
do $$ begin
  if not exists (
    select 1 from data_people group by company_id, lower(btrim(name)) having count(*) > 1
  ) then
    create unique index if not exists data_people_company_name_uidx on data_people (company_id, lower(btrim(name)));
  end if;
end $$;

-- ── custody trail ────────────────────────────────────────────────
alter table shoot_data_records
  add column if not exists received_by_uid       uuid references users (user_id) on delete set null,
  add column if not exists verified_by           uuid references users (user_id) on delete set null,
  add column if not exists handed_to_editor_at   timestamptz,
  add column if not exists handed_to_editor_by   uuid references users (user_id) on delete set null,
  add column if not exists archived_at           timestamptz,
  add column if not exists archive_location_id   uuid references storage_locations (id) on delete set null;
create index if not exists sdr_user_idx on shoot_data_records (user_id);

-- The stage, now with Archived after the copies. Same order as 0160
-- otherwise; keep apps/web/src/features/data/stage.ts deriveStage in step.
create or replace function data_record_stage(
  p_primary       text,
  p_backup        text,
  p_date_received date,
  p_issue         boolean,
  p_not_required  boolean,
  p_archived      timestamptz
)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_not_required, false) or (p_backup = 'not_required' and p_primary = 'pending')
      then 'not_required'
    when coalesce(p_issue, false) or p_primary = 'issue' or p_backup = 'issue'
      then 'issue'
    when p_archived is not null and p_primary in ('copied', 'verified')
      then 'archived'
    when p_primary = 'verified' and p_backup in ('verified', 'not_required')
      then 'verified'
    when p_primary in ('copied', 'verified') and p_backup in ('copied', 'verified', 'not_required')
      then 'backed_up'
    when p_primary in ('copied', 'verified')
      then 'copied'
    when p_date_received is not null
      then 'received'
    else 'with_shooter'
  end
$$;

create or replace function sdr_derive_stage()
returns trigger
language plpgsql
as $$
begin
  -- A copy marked done says where it is -- checked when the status moves, so
  -- an old row can still have its notes edited.
  if new.primary_status in ('copied', 'verified')
     and (tg_op = 'INSERT' or old.primary_status is distinct from new.primary_status)
     and new.primary_location_id is null
     and nullif(btrim(new.folder_path), '') is null
     and nullif(btrim(new.cloud_link), '') is null then
    raise exception 'say where the main copy is first' using errcode = '22023';
  end if;
  if new.backup_status in ('copied', 'verified')
     and (tg_op = 'INSERT' or old.backup_status is distinct from new.backup_status)
     and new.backup_location_id is null
     and nullif(btrim(new.backup_folder_path), '') is null
     and nullif(btrim(new.backup_cloud_link), '') is null then
    raise exception 'say where the backup is first' using errcode = '22023';
  end if;
  new.data_status := data_record_stage(
    new.primary_status, new.backup_status, new.date_received, new.issue_found, new.is_not_required, new.archived_at
  );
  -- Verified is a fact about the two copies, whatever stage came after it.
  if new.primary_status = 'verified' and new.backup_status in ('verified', 'not_required') then
    new.verified_at := coalesce(new.verified_at, now());
    new.verified_by := coalesce(new.verified_by, auth.uid());
  else
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end;
$$;

alter table shoot_data_records drop constraint if exists shoot_data_records_data_status_check;
update shoot_data_records set data_status = data_status;
alter table shoot_data_records
  add constraint shoot_data_records_data_status_check
    check (data_status in ('with_shooter', 'received', 'copied', 'backed_up', 'verified', 'archived', 'issue', 'not_required'));

-- ── a copy says where it is ──────────────────────────────────────
create or replace function set_data_track(p_record_id uuid, p_track text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r shoot_data_records;
begin
  if not (is_current_user_active() and is_current_admin_or_manager()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_r from shoot_data_records where id = p_record_id and company_id = get_current_company_id();
  if not found then
    raise exception 'record not found' using errcode = 'P0002';
  end if;
  if p_track = 'primary' then
    if p_status not in ('pending', 'copied', 'verified', 'issue') then
      raise exception 'invalid status for the primary copy' using errcode = '22023';
    end if;
    if p_status in ('copied', 'verified')
       and v_r.primary_location_id is null
       and nullif(btrim(v_r.folder_path), '') is null
       and nullif(btrim(v_r.cloud_link), '') is null then
      raise exception 'say where the main copy is first' using errcode = '22023';
    end if;
    update shoot_data_records set primary_status = p_status where id = p_record_id;
  elsif p_track = 'backup' then
    if p_status not in ('pending', 'copied', 'verified', 'issue', 'not_required') then
      raise exception 'invalid status for the backup copy' using errcode = '22023';
    end if;
    if p_status in ('copied', 'verified')
       and v_r.backup_location_id is null
       and nullif(btrim(v_r.backup_folder_path), '') is null
       and nullif(btrim(v_r.backup_cloud_link), '') is null then
      raise exception 'say where the backup is first' using errcode = '22023';
    end if;
    update shoot_data_records set backup_status = p_status where id = p_record_id;
  else
    raise exception 'invalid track' using errcode = '22023';
  end if;
end;
$$;
revoke all on function set_data_track(uuid, text, text) from public, anon;
grant execute on function set_data_track(uuid, text, text) to authenticated;

-- ── the record a booking gets when it has none ───────────────────
-- A label people can find later, and a type that suits the role.
create or replace function data_record_for_slot(p_slot_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_s  record;
  v_role text;
begin
  select id into v_id from shoot_data_records where slot_id = p_slot_id order by created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;
  select t.id, t.company_id, t.user_id, t.service_name, t.shoot_id, u.name as user_name,
         s.name as shoot_name, s.project_id
    into v_s
    from team_assignment_slots t
    join shoots s on s.id = t.shoot_id
    left join users u on u.user_id = t.user_id
   where t.id = p_slot_id;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  v_role := lower(coalesce(v_s.service_name, ''));
  insert into shoot_data_records (
    company_id, project_id, shoot_id, slot_id, user_id, team_member_name, requirement_name,
    data_label, data_type)
  values (
    v_s.company_id, v_s.project_id, v_s.shoot_id, v_s.id, v_s.user_id, v_s.user_name, v_s.service_name,
    left(concat_ws(' · ', v_s.shoot_name, nullif(btrim(v_s.service_name), ''), v_s.user_name), 160),
    case
      when v_role like '%drone%' then 'drone'
      when v_role like '%video%' or v_role like '%cinema%' or v_role like '%film%' then 'videos'
      when v_role like '%audio%' or v_role like '%sound%' then 'audio'
      when v_role like '%edit%' then 'edited_data'
      when v_role like '%album%' or v_role like '%design%' then 'project_files'
      else 'photos'
    end)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function data_record_for_slot(uuid) from public, anon, authenticated;

-- ── crew hand their own cards over ───────────────────────────────
create or replace function handover_slot_data(
  p_slot_id         uuid,
  p_card_count      int,
  p_size_gb         numeric,
  p_handed_to_uid   uuid,
  p_handed_to_name  text,
  p_notes           text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot team_assignment_slots;
  v_id   uuid;
  v_name text;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_slot from team_assignment_slots
   where id = p_slot_id and company_id = get_current_company_id();
  if not found or v_slot.user_id is distinct from auth.uid() then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v_slot.status <> 'booked' or v_slot.shoot_id is null then
    raise exception 'this booking has no data to hand over' using errcode = '22023';
  end if;
  if coalesce(p_card_count, 0) < 0 or coalesce(p_size_gb, 0) < 0 then
    raise exception 'cards and size cannot be negative' using errcode = '22023';
  end if;
  if p_handed_to_uid is not null then
    select name into v_name from users where user_id = p_handed_to_uid and company_id = v_slot.company_id;
    if not found then
      raise exception 'that person is not on the team' using errcode = '22023';
    end if;
  end if;

  v_id := data_record_for_slot(p_slot_id);
  update shoot_data_records
     set card_count       = coalesce(p_card_count, card_count),
         size_gb          = coalesce(p_size_gb, size_gb),
         date_received    = coalesce(date_received, (now() at time zone 'Asia/Kolkata')::date),
         received_by_uid  = case when p_handed_to_uid is not null then p_handed_to_uid else received_by_uid end,
         received_by_name = coalesce(v_name, nullif(btrim(p_handed_to_name), ''), received_by_name),
         notes            = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = v_id;
  return v_id;
end;
$$;
revoke all on function handover_slot_data(uuid, int, numeric, uuid, text, text) from public, anon;
grant execute on function handover_slot_data(uuid, int, numeric, uuid, text, text) to authenticated;

-- ── one change across many ───────────────────────────────────────
-- p_action: received | copied | backed_up | verified | handed_to_editor | archived.
-- copied / backed_up / archived take a location. A row a change does not fit
-- (verify before anything was copied, say) is skipped and counted, not failed.
create or replace function bulk_data_update(
  p_slot_ids    uuid[],
  p_record_ids  uuid[],
  p_action      text,
  p_location_id uuid,
  p_folder      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_me      uuid := auth.uid();
  v_today   date := (now() at time zone 'Asia/Kolkata')::date;
  v_ids     uuid[] := coalesce(p_record_ids, '{}');
  v_sid     uuid;
  v_created int := 0;
  v_updated int := 0;
  v_total   int;
  v_folder  text := nullif(btrim(p_folder), '');
begin
  if not (is_current_user_active() and is_current_admin_or_manager()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action not in ('received', 'copied', 'backed_up', 'verified', 'handed_to_editor', 'archived') then
    raise exception 'invalid action' using errcode = '22023';
  end if;
  if p_action in ('copied', 'backed_up', 'archived') then
    if p_location_id is null then
      raise exception 'pick a location' using errcode = '22023';
    end if;
    perform 1 from storage_locations where id = p_location_id and company_id = v_company and coalesce(is_active, true);
    if not found then
      raise exception 'location not found' using errcode = '22023';
    end if;
  end if;

  -- Bookings without a record get one, so "received" works straight off
  -- the Missing lane.
  foreach v_sid in array coalesce(p_slot_ids, '{}') loop
    perform 1 from team_assignment_slots
     where id = v_sid and company_id = v_company and status = 'booked' and shoot_id is not null;
    if not found then
      continue;
    end if;
    if not exists (select 1 from shoot_data_records where slot_id = v_sid) then
      v_created := v_created + 1;
    end if;
    v_ids := v_ids || data_record_for_slot(v_sid);
  end loop;

  select count(distinct x) into v_total from unnest(v_ids) x;

  if p_action = 'received' then
    update shoot_data_records
       set date_received = coalesce(date_received, v_today),
           received_by_uid = coalesce(received_by_uid, v_me)
     where id = any(v_ids) and company_id = v_company
       and primary_status <> 'issue' and data_status in ('with_shooter', 'received');
  elsif p_action = 'copied' then
    update shoot_data_records
       set primary_location_id = p_location_id,
           folder_path = coalesce(v_folder, folder_path),
           primary_status = case when primary_status = 'pending' then 'copied' else primary_status end,
           date_received = coalesce(date_received, v_today),
           copied_by_uid = case when copied_by_uid is null and copied_by_name is null then v_me else copied_by_uid end
     where id = any(v_ids) and company_id = v_company
       and primary_status in ('pending', 'copied');
  elsif p_action = 'backed_up' then
    update shoot_data_records
       set backup_location_id = p_location_id,
           backup_folder_path = coalesce(v_folder, backup_folder_path),
           backup_status = case when backup_status in ('pending', 'not_required') then 'copied' else backup_status end
     where id = any(v_ids) and company_id = v_company
       and primary_status in ('copied', 'verified') and backup_status in ('pending', 'copied', 'not_required');
  elsif p_action = 'verified' then
    update shoot_data_records
       set primary_status = 'verified',
           backup_status = case when backup_status = 'copied' then 'verified' else backup_status end
     where id = any(v_ids) and company_id = v_company
       and primary_status in ('copied', 'verified')
       and backup_status in ('copied', 'verified', 'not_required')
       and (primary_location_id is not null or nullif(btrim(folder_path), '') is not null or nullif(btrim(cloud_link), '') is not null)
       and (backup_status = 'not_required' or backup_location_id is not null
            or nullif(btrim(backup_folder_path), '') is not null or nullif(btrim(backup_cloud_link), '') is not null);
  elsif p_action = 'handed_to_editor' then
    update shoot_data_records
       set handed_to_editor_at = coalesce(handed_to_editor_at, now()),
           handed_to_editor_by = coalesce(handed_to_editor_by, v_me)
     where id = any(v_ids) and company_id = v_company
       and data_status in ('copied', 'backed_up', 'verified', 'archived');
  else
    update shoot_data_records
       set archived_at = coalesce(archived_at, now()),
           archive_location_id = p_location_id
     where id = any(v_ids) and company_id = v_company
       and primary_status in ('copied', 'verified')
       and data_status not in ('issue', 'not_required');
  end if;
  get diagnostics v_updated = row_count;

  return jsonb_build_object('updated', v_updated, 'created', v_created, 'skipped', greatest(v_total - v_updated, 0));
end;
$$;
revoke all on function bulk_data_update(uuid[], uuid[], text, uuid, text) from public, anon;
grant execute on function bulk_data_update(uuid[], uuid[], text, uuid, text) to authenticated;

-- ── every evening, until it is safe ──────────────────────────────
-- Crew: a booking a day or more past with no cards handed over. Managers: one
-- digest a day of what is still not safe, with how much is late (3+ days) and
-- critical (7+ days). Deduped per day, so it repeats until the data moves.
create or replace function run_data_reminder_cron(p_dry_run boolean default false, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local   timestamp := p_now at time zone 'Asia/Kolkata';
  v_today   date := v_local::date;
  v_crew    int := 0;
  v_digests int := 0;
  v_created int := 0;
  v_r       record;
  v_summary jsonb;
  v_run     uuid;
begin
  insert into cron_runs (job_name, dry_run) values ('data_reminder_cron', p_dry_run) returning id into v_run;

  if extract(hour from v_local) >= 18 then
    -- Crew holding cards.
    for v_r in
      select t.id, t.company_id, t.user_id, t.shoot_id, s.name as shoot_name,
             v_today - coalesce(s.shoot_date, (t.start_at at time zone 'Asia/Kolkata')::date) as age
        from team_assignment_slots t
        join shoots s on s.id = t.shoot_id
        left join shoot_data_records d on d.slot_id = t.id
       where t.status = 'booked'
         and s.status <> 'cancelled'
         and not (not t.data_required and nullif(btrim(t.data_not_required_reason), '') is not null)
         and coalesce(s.shoot_date, (t.start_at at time zone 'Asia/Kolkata')::date) between v_today - 30 and v_today - 1
         and (d.id is null or d.data_status = 'with_shooter')
    loop
      v_crew := v_crew + 1;
      if not p_dry_run then
        if create_notification(
             v_r.company_id, v_r.user_id, 'data.handover',
             'Hand over your cards: ' || coalesce(v_r.shoot_name, 'shoot'),
             case when v_r.age = 1 then 'From yesterday''s shoot.' else 'From ' || v_r.age || ' days ago.' end
               || ' Tap Hand over data on My Shoots once they are with the studio.',
             'data_handover:' || v_r.id || ':' || v_today,
             'shoot', v_r.shoot_id, case when v_r.age >= 3 then 'warning' else 'info' end, '/shoots/my') then
          v_created := v_created + 1;
        end if;
      end if;
    end loop;

    -- One digest per manager per studio.
    for v_r in
      with rows as (
        select t.company_id,
               v_today - coalesce(s.shoot_date, (t.start_at at time zone 'Asia/Kolkata')::date) as age,
               d.id is null as missing
          from team_assignment_slots t
          join shoots s on s.id = t.shoot_id
          left join shoot_data_records d on d.slot_id = t.id
         where t.status = 'booked'
           and s.status <> 'cancelled'
           and not (not t.data_required and nullif(btrim(t.data_not_required_reason), '') is not null)
           and coalesce(s.shoot_date, (t.start_at at time zone 'Asia/Kolkata')::date) between v_today - 180 and v_today - 1
           and (d.id is null or d.data_status in ('with_shooter', 'received', 'copied', 'issue'))
      ), per as (
        select company_id,
               count(*) as open,
               count(*) filter (where missing) as missing,
               count(*) filter (where age >= 3 and age < 7) as late,
               count(*) filter (where age >= 7) as critical
          from rows group by company_id
      )
      select per.*, u.user_id
        from per
        cross join lateral notification_admin_recipients(per.company_id) u(user_id)
       where per.open > 0
    loop
      v_digests := v_digests + 1;
      if not p_dry_run then
        if create_notification(
             v_r.company_id, v_r.user_id, 'data.digest',
             'Data: ' || v_r.open || ' not safe yet',
             concat_ws(' · ',
               case when v_r.missing > 0 then v_r.missing || ' not handed over' end,
               case when v_r.late > 0 then v_r.late || ' late (3+ days)' end,
               case when v_r.critical > 0 then v_r.critical || ' critical (7+ days)' end),
             'data_digest:' || v_r.company_id || ':' || v_today,
             'data_record', null, case when v_r.critical > 0 then 'critical' when v_r.late > 0 then 'warning' else 'info' end, '/data-management') then
          v_created := v_created + 1;
        end if;
      end if;
    end loop;
  end if;

  v_summary := jsonb_build_object('crew_reminders', v_crew, 'digests', v_digests, 'notifications_created', v_created, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;
revoke all on function run_data_reminder_cron(boolean, timestamptz) from public, anon;
grant execute on function run_data_reminder_cron(boolean, timestamptz) to service_role;
