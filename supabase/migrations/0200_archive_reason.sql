-- Why a lead was archived, and who did it.
--
-- 0032 gave crm_leads `is_archived` and `archived_at`: a boolean and a
-- timestamp. So a studio finding a lead in the archive six months later can see
-- that it was archived and when, and has no way to learn whether it was a
-- duplicate, a wrong number, a tyre-kicker or a mistake. The reference product
-- we compared against records a reason and the person, and restores from the
-- archive with both intact.
--
-- The reason is optional on purpose. Bulk-archiving four hundred stale leads
-- should not demand an essay, and a required field that people fill with "." is
-- worse than an empty one.

alter table crm_leads add column if not exists archive_reason text
  check (archive_reason is null or char_length(archive_reason) between 2 and 300);
alter table crm_leads add column if not exists archived_by uuid references auth.users (id) on delete set null;

-- ── who, recorded by the database rather than by each caller ───
-- There are four ways a lead gets archived today: the drawer's PATCH, the bulk
-- toolbar through crm_bulk_patch, the "archive lost leads" sweep in settings,
-- and crm_restore_leads undoing one of those. Asking each of them to remember
-- to stamp archived_by is asking for three of them to do it and one to forget,
-- which is how archived_at itself came to be set in a trigger in 0032.
--
-- It also clears both columns on the way back out. Without that, a lead
-- restored by the undo toast would keep a reason explaining an archiving that
-- no longer happened -- and crm_bulk_patch's snapshot does not carry these
-- columns, so the undo path cannot put them right by itself. (Adding them to
-- that snapshot would change the function's RETURNS TABLE, which
-- `create or replace` cannot do; a drop-and-recreate of a function the bulk
-- toolbar depends on is not worth it for two columns.)
create or replace function crm_leads_stamp_archive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_archived and not coalesce(old.is_archived, false) then
    new.archived_by := coalesce(new.archived_by, auth.uid());
  elsif coalesce(old.is_archived, false) and not new.is_archived then
    new.archive_reason := null;
    new.archived_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists crm_leads_stamp_archive on crm_leads;
create trigger crm_leads_stamp_archive before update on crm_leads
  for each row execute function crm_leads_stamp_archive();

-- ── the reason, through the bulk path ─────────────────────────
-- crm_bulk_patch is copied from its latest definition (0107) with one column
-- added to the update. The argument list and the RETURNS TABLE are untouched,
-- so this is a plain replace with no drop and nothing else in the CRM notices.
create or replace function crm_bulk_patch(p_ids uuid[], p_patch jsonb)
returns table (
  id uuid, status text, assigned_to uuid, is_hot boolean, follow_up_at timestamptz, is_archived boolean,
  deal_value numeric, probability smallint, lost_reason text, lost_competitor text, stage_id uuid, close_date date,
  quality text, contacted_status text, group_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_pipeline uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_patch ? 'status' and p_patch->>'status' not in ('new','contacted','qualified','proposal_sent','converted','lost') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  if p_patch ? 'quality' and p_patch->>'quality' is not null
     and p_patch->>'quality' not in ('hot', 'warm', 'cold') then
    raise exception 'unknown quality' using errcode = '22023';
  end if;
  if p_patch ? 'contacted_status' and p_patch->>'contacted_status' not in ('uncontacted', 'contacted', 'unreachable') then
    raise exception 'unknown contacted_status' using errcode = '22023';
  end if;
  if p_patch ? 'stage_id' then
    select s.pipeline_id into v_pipeline from crm_pipeline_stages s
     where s.id = (p_patch->>'stage_id')::uuid and s.company_id = v_company;
    if v_pipeline is null then
      raise exception 'unknown stage' using errcode = '22023';
    end if;
    if exists (
      select 1 from crm_leads l
      where l.id = any(p_ids) and l.company_id = v_company and l.pipeline_id is distinct from v_pipeline
    ) then
      raise exception 'That stage belongs to another pipeline.' using errcode = 'P0001';
    end if;
  end if;

  return query
    select l.id, l.status, l.assigned_to, l.is_hot, l.follow_up_at, l.is_archived,
           l.deal_value, l.probability, l.lost_reason, l.lost_competitor, l.stage_id, l.close_date,
           l.quality, l.contacted_status, l.group_name
    from crm_leads l
    where l.id = any(p_ids) and l.company_id = v_company;

  update crm_leads l
     set status = coalesce(p_patch->>'status', l.status),
         stage_id = case when p_patch ? 'stage_id' then (p_patch->>'stage_id')::uuid else l.stage_id end,
         lost_reason = case when p_patch ? 'lost_reason' then nullif(p_patch->>'lost_reason', '') else l.lost_reason end,
         lost_competitor = case when p_patch ? 'lost_competitor' then nullif(p_patch->>'lost_competitor', '') else l.lost_competitor end,
         assigned_to = case when p_patch ? 'assigned_to' then nullif(p_patch->>'assigned_to', '')::uuid else l.assigned_to end,
         is_hot = coalesce((p_patch->>'is_hot')::boolean, l.is_hot),
         quality = case when p_patch ? 'quality' then nullif(p_patch->>'quality', '') else l.quality end,
         contacted_status = coalesce(nullif(p_patch->>'contacted_status', ''), l.contacted_status),
         group_name = case when p_patch ? 'group_name' then nullif(p_patch->>'group_name', '') else l.group_name end,
         notes = case when p_patch ? 'note' and nullif(p_patch->>'note', '') is not null
                      then nullif(trim(coalesce(l.notes, '') || chr(10) || (p_patch->>'note')), '')
                      else l.notes end,
         follow_up_at = case when p_patch ? 'follow_up_at' then nullif(p_patch->>'follow_up_at', '')::timestamptz else l.follow_up_at end,
         is_archived = coalesce((p_patch->>'is_archived')::boolean, l.is_archived),
         -- New in 0200. The trigger above fills in who and clears both on restore.
         archive_reason = case when p_patch ? 'archive_reason' then nullif(p_patch->>'archive_reason', '') else l.archive_reason end,
         deal_value = case when p_patch ? 'deal_value' then nullif(p_patch->>'deal_value', '')::numeric else l.deal_value end,
         probability = case when p_patch ? 'probability' then nullif(p_patch->>'probability', '')::smallint else l.probability end,
         close_date = case when p_patch ? 'close_date' then nullif(p_patch->>'close_date', '')::date else l.close_date end
   where l.id = any(p_ids) and l.company_id = v_company;
end;
$$;
