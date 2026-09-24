-- A data record belongs to a booking: whose cards they were, and who copied
-- them.
--
-- The shoot card now has a Data button on each assigned person, so a record
-- needs to say which booking (team_assignment_slots) it is for. Until now the
-- only link was two free-text columns (team_member_name, requirement_name)
-- that nothing wrote, and copied_by_uid was always stamped with whoever
-- happened to be logged in -- not the intern who actually copied the cards.
--
-- data_status also stops being something a caller sets. It was a free
-- column whose check (0110: pending/copied/verified/issue_found/not_required)
-- rejected the very values the Data Management page sent ('received'), so
-- "Mark received" failed. It is now derived from the two copy tracks by a
-- trigger, so it can never disagree with them.

alter table shoot_data_records
  add column if not exists slot_id uuid references team_assignment_slots (id) on delete set null,
  add column if not exists user_id uuid references users (user_id) on delete set null,
  -- A handler who is not on the team (a one-off helper): a typed name.
  add column if not exists copied_by_name text;
create index if not exists sdr_slot_idx on shoot_data_records (slot_id);

-- Each copy can also be marked as having a problem; the backup copy can be
-- declared not needed at all.
alter table shoot_data_records drop constraint if exists shoot_data_records_primary_status_check;
alter table shoot_data_records drop constraint if exists shoot_data_records_backup_status_check;
alter table shoot_data_records
  add constraint shoot_data_records_primary_status_check
    check (primary_status in ('pending', 'copied', 'verified', 'issue')),
  add constraint shoot_data_records_backup_status_check
    check (backup_status in ('pending', 'copied', 'verified', 'issue', 'not_required'));

-- The stage a record is at, from its tracks. The order matters: "not
-- required" and "issue" outrank progress, and a record is only "verified"
-- once both copies are (or the backup was never needed).
create or replace function data_record_stage(
  p_primary       text,
  p_backup        text,
  p_date_received date,
  p_issue         boolean,
  p_not_required  boolean
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

alter table shoot_data_records drop constraint if exists shoot_data_records_data_status_check;
alter table shoot_data_records alter column data_status set default 'with_shooter';

create or replace function sdr_derive_stage()
returns trigger
language plpgsql
as $$
begin
  new.data_status := data_record_stage(
    new.primary_status, new.backup_status, new.date_received, new.issue_found, new.is_not_required
  );
  -- verified_at is when custody was complete; it goes if that stops being true.
  if new.data_status = 'verified' then
    new.verified_at := coalesce(new.verified_at, now());
  else
    new.verified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists sdr_derive_stage on shoot_data_records;
create trigger sdr_derive_stage
  before insert or update on shoot_data_records
  for each row execute function sdr_derive_stage();

-- Re-derive every existing row once, then hold the column to the new values.
update shoot_data_records set data_status = data_status;
alter table shoot_data_records
  add constraint shoot_data_records_data_status_check
    check (data_status in ('with_shooter', 'received', 'copied', 'backed_up', 'verified', 'issue', 'not_required'));

-- Move one copy track. The one write path for track status, so the rules
-- (which statuses each track takes, company scope, active caller) live here.
create or replace function set_data_track(p_record_id uuid, p_track text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_track = 'primary' then
    if p_status not in ('pending', 'copied', 'verified', 'issue') then
      raise exception 'invalid status for the primary copy';
    end if;
    update shoot_data_records set primary_status = p_status
     where id = p_record_id and company_id = get_current_company_id();
  elsif p_track = 'backup' then
    if p_status not in ('pending', 'copied', 'verified', 'issue', 'not_required') then
      raise exception 'invalid status for the backup copy';
    end if;
    update shoot_data_records set backup_status = p_status
     where id = p_record_id and company_id = get_current_company_id();
  else
    raise exception 'invalid track';
  end if;
  if not found then
    raise exception 'record not found' using errcode = '42501';
  end if;
end;
$$;
revoke all on function set_data_track(uuid, text, text) from public, anon;
grant execute on function set_data_track(uuid, text, text) to authenticated;

-- Kept for its existing caller (POST /data/:id/verify); verified_at is the
-- trigger's job now.
create or replace function verify_data_record(p_record_id uuid, p_track text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_data_track(p_record_id, p_track, 'verified');
end;
$$;
revoke all on function verify_data_record(uuid, text) from public, anon;
grant execute on function verify_data_record(uuid, text) to authenticated;
