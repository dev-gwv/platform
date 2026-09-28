-- 0209: the CRM's closed fields open up, stages carry a colour, follow-ups
-- become tasks.
--
-- The owner's verdict on the Leads page was that it was closed and colourless
-- next to the Control Center's: no colour a studio could choose for a stage,
-- no way to add a quality or a source of their own, and one follow-up date per
-- lead with nowhere to say what it was for. This migration is the data half:
--
--   1. Stages get a `color` (one of the app's seven tones) and `is_active`.
--      Existing stages are backfilled with exactly the colour the board already
--      showed (the name hash in BoardTabs' stageHue), so nothing changes on
--      deploy. A stage inserted without a colour gets the same hash.
--   2. custom_lookups gets a `color`, and every studio gets four CRM lists it
--      can grow from any form: lead_quality, lead_source (coloured),
--      follow_up_type, follow_up_priority.
--   3. crm_leads.quality and .source stop being enums. "Hot" is still the one
--      that ranks calls (is_hot); any other value is the studio's own word.
--   4. Follow-ups are tasks (crm_activities type 'task', with a priority).
--      crm_leads.follow_up_at stays the one column everything reads -- queue,
--      cron, day report, morning email -- and is kept equal to the earliest
--      open task. A legacy write to follow_up_at (a call log, a workflow, a
--      cadence, a bulk edit) makes one task, so both views agree.
--   5. The single notes box on a lead becomes the first, pinned note in its
--      thread. The column stays: search and import still read it.

-- ── 1. stage colour and active ────────────────────────────────
alter table crm_pipeline_stages
  add column if not exists color text
    check (color is null or color in ('blue', 'green', 'violet', 'amber', 'rose', 'teal', 'slate')),
  add column if not exists is_active boolean not null default true;

-- The board's hash, in SQL: won green, lost rose, open stages by name over
-- the six hues in BoardTabs' order. h = h*31 + code, unsigned 32-bit.
create or replace function crm_stage_default_color(p_name text, p_kind text)
returns text
language plpgsql
immutable
as $$
declare
  v_h bigint := 0;
  v_hues text[] := array['blue', 'violet', 'teal', 'amber', 'green', 'rose'];
  v_ch text;
begin
  if p_kind = 'won' then return 'green'; end if;
  if p_kind = 'lost' then return 'rose'; end if;
  foreach v_ch in array regexp_split_to_array(lower(coalesce(p_name, '')), '')
  loop
    v_h := (v_h * 31 + ascii(v_ch)) % 4294967296;
  end loop;
  return v_hues[(v_h % 6) + 1];
end;
$$;

update crm_pipeline_stages set color = crm_stage_default_color(name, kind) where color is null;

create or replace function crm_pipeline_stages_color()
returns trigger
language plpgsql
as $$
begin
  if new.color is null then
    new.color := crm_stage_default_color(new.name, new.kind);
  end if;
  return new;
end;
$$;
drop trigger if exists crm_pipeline_stages_color on crm_pipeline_stages;
create trigger crm_pipeline_stages_color before insert on crm_pipeline_stages
  for each row execute function crm_pipeline_stages_color();

alter table crm_pipeline_stages alter column color set not null;

-- ── 2. coloured lookups, and the CRM's own lists ──────────────
alter table custom_lookups
  add column if not exists color text
    check (color is null or color in ('blue', 'green', 'violet', 'amber', 'rose', 'teal', 'slate'));

create or replace function crm_seed_lookups(p_company uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into custom_lookups (company_id, category, value, sort_order, is_active, color)
  select p_company, v.category, v.value, v.sort_order, true, v.color
  from (values
    ('lead_quality', 'hot', 1, 'rose'),
    ('lead_quality', 'warm', 2, 'amber'),
    ('lead_quality', 'cold', 3, 'blue'),
    ('lead_source', 'manual', 1, 'slate'),
    ('lead_source', 'facebook', 2, 'blue'),
    ('lead_source', 'instagram', 3, 'rose'),
    ('lead_source', 'whatsapp', 4, 'green'),
    ('lead_source', 'webform', 5, 'violet'),
    ('lead_source', 'referral', 6, 'amber'),
    ('lead_source', 'enquiry', 7, 'teal'),
    ('lead_source', 'google_form', 8, 'violet'),
    ('lead_source', 'csv_import', 9, 'slate'),
    ('lead_source', 'other', 10, 'slate'),
    ('follow_up_type', 'Call', 1, 'blue'),
    ('follow_up_type', 'WhatsApp', 2, 'green'),
    ('follow_up_type', 'Email', 3, 'violet'),
    ('follow_up_type', 'Meeting', 4, 'amber'),
    ('follow_up_type', 'Site visit', 5, 'teal'),
    ('follow_up_priority', 'Urgent', 1, 'rose'),
    ('follow_up_priority', 'High', 2, 'amber'),
    ('follow_up_priority', 'Normal', 3, 'blue'),
    ('follow_up_priority', 'Low', 4, 'slate')
  ) as v(category, value, sort_order, color)
  on conflict (company_id, category, value) do update
    set color = coalesce(custom_lookups.color, excluded.color);
end;
$$;
revoke all on function crm_seed_lookups(uuid) from public, anon, authenticated;

select crm_seed_lookups(c.id) from companies c;

-- New studios: a trigger of its own, so seed_custom_lookups_for_company (whose
-- history of lost categories is told in 0154) is left alone.
create or replace function companies_seed_crm_lookups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform crm_seed_lookups(new.id);
  return null;
end;
$$;
drop trigger if exists companies_seed_crm_lookups on companies;
create trigger companies_seed_crm_lookups after insert on companies
  for each row execute function companies_seed_crm_lookups();

-- ── 3. quality and source are the studio's words ──────────────
alter table crm_leads drop constraint if exists crm_leads_source_check;
alter table crm_leads drop constraint if exists crm_leads_quality_check;
alter table crm_leads drop constraint if exists crm_leads_source_len;
alter table crm_leads drop constraint if exists crm_leads_quality_len;
alter table crm_leads add constraint crm_leads_source_len
  check (source is null or char_length(source) between 1 and 40);
alter table crm_leads add constraint crm_leads_quality_len
  check (quality is null or char_length(quality) between 1 and 40);

alter table crm_webhook_sources drop constraint if exists crm_webhook_sources_default_quality_check;
alter table crm_webhook_sources drop constraint if exists crm_webhook_sources_default_quality_len;
alter table crm_webhook_sources add constraint crm_webhook_sources_default_quality_len
  check (default_quality is null or char_length(default_quality) <= 40);

-- crm_bulk_patch: copied from its latest definition (0200). The only change is
-- the quality guard, which now checks length instead of a fixed list. Same
-- argument list and RETURNS TABLE, so a plain replace.
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
     and char_length(p_patch->>'quality') > 40 then
    raise exception 'quality is too long' using errcode = '22023';
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
         archive_reason = case when p_patch ? 'archive_reason' then nullif(p_patch->>'archive_reason', '') else l.archive_reason end,
         deal_value = case when p_patch ? 'deal_value' then nullif(p_patch->>'deal_value', '')::numeric else l.deal_value end,
         probability = case when p_patch ? 'probability' then nullif(p_patch->>'probability', '')::smallint else l.probability end,
         close_date = case when p_patch ? 'close_date' then nullif(p_patch->>'close_date', '')::date else l.close_date end
   where l.id = any(p_ids) and l.company_id = v_company;
end;
$$;

-- ── 4. follow-ups are tasks ───────────────────────────────────
alter table crm_activities
  add column if not exists priority text check (priority is null or char_length(priority) <= 40);

create index if not exists crm_activities_open_tasks_lead_idx
  on crm_activities (lead_id, due_at) where type = 'task' and done_at is null;

-- A task changed: the lead's follow_up_at becomes the earliest open task.
-- When the lead has no dated open task left, follow_up_at is cleared only if
-- it was this task's date -- a legacy date with no task behind it is left.
create or replace function crm_tasks_sync_follow_up()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead uuid := coalesce(new.lead_id, old.lead_id);
  v_next timestamptz;
  v_old_due timestamptz := case when tg_op in ('UPDATE', 'DELETE') then old.due_at end;
begin
  if v_lead is null then return null; end if;
  if tg_op <> 'DELETE' and new.type <> 'task' and (tg_op = 'INSERT' or old.type <> 'task') then return null; end if;
  if tg_op = 'DELETE' and old.type <> 'task' then return null; end if;
  if tg_op = 'UPDATE' and new.due_at is not distinct from old.due_at
     and new.done_at is not distinct from old.done_at and new.type = old.type then
    return null;
  end if;

  select min(a.due_at) into v_next
    from crm_activities a
   where a.lead_id = v_lead and a.type = 'task' and a.done_at is null and a.due_at is not null;

  perform set_config('crm.task_sync', '1', true);
  if v_next is not null then
    update crm_leads set follow_up_at = v_next where id = v_lead and follow_up_at is distinct from v_next;
  elsif v_old_due is not null or (tg_op <> 'DELETE' and new.due_at is not null) then
    update crm_leads set follow_up_at = null
     where id = v_lead and follow_up_at in (v_old_due, case when tg_op <> 'DELETE' then new.due_at end);
  end if;
  perform set_config('crm.task_sync', '0', true);
  return null;
end;
$$;
drop trigger if exists crm_tasks_sync_follow_up on crm_activities;
create trigger crm_tasks_sync_follow_up after insert or update or delete on crm_activities
  for each row execute function crm_tasks_sync_follow_up();

-- A legacy path set follow_up_at: make sure a task stands behind it. Cleared:
-- the auto tasks go (a task someone wrote by hand is theirs to close).
create or replace function crm_leads_follow_up_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('crm.task_sync', true), '0') = '1' then return null; end if;
  if new.follow_up_at is not distinct from old.follow_up_at then return null; end if;

  perform set_config('crm.task_sync', '1', true);
  if new.follow_up_at is null then
    delete from crm_activities a
     where a.lead_id = new.id and a.type = 'task' and a.done_at is null and (a.meta->>'auto') = 'true';
  else
    -- Move the lead's auto task if there is one; otherwise make one.
    update crm_activities a set due_at = new.follow_up_at, assigned_to = coalesce(a.assigned_to, new.assigned_to)
     where a.id = (select a2.id from crm_activities a2
                    where a2.lead_id = new.id and a2.type = 'task' and a2.done_at is null
                      and (a2.meta->>'auto') = 'true'
                    order by a2.due_at nulls last limit 1);
    if not found and not exists (
      select 1 from crm_activities a
       where a.lead_id = new.id and a.type = 'task' and a.done_at is null and a.due_at = new.follow_up_at
    ) then
      insert into crm_activities (company_id, lead_id, type, direction, subject, due_at, assigned_to, priority, meta)
      values (new.company_id, new.id, 'task', 'none', 'Follow-up', new.follow_up_at, new.assigned_to, 'Normal',
              '{"auto": true}'::jsonb);
    end if;
  end if;
  perform set_config('crm.task_sync', '0', true);
  return null;
end;
$$;
drop trigger if exists zz_crm_leads_follow_up_task on crm_leads;
create trigger zz_crm_leads_follow_up_task after update of follow_up_at on crm_leads
  for each row execute function crm_leads_follow_up_task();

-- New leads that arrive with a follow-up (import, webhook defaults) get their
-- task too.
create or replace function crm_leads_follow_up_task_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.follow_up_at is null then return null; end if;
  perform set_config('crm.task_sync', '1', true);
  insert into crm_activities (company_id, lead_id, type, direction, subject, due_at, assigned_to, priority, meta)
  values (new.company_id, new.id, 'task', 'none', 'Follow-up', new.follow_up_at, new.assigned_to, 'Normal',
          '{"auto": true}'::jsonb);
  perform set_config('crm.task_sync', '0', true);
  return null;
end;
$$;
drop trigger if exists zz_crm_leads_follow_up_task_insert on crm_leads;
create trigger zz_crm_leads_follow_up_task_insert after insert on crm_leads
  for each row execute function crm_leads_follow_up_task_insert();

-- Every open follow-up today gets its task, so the drawer's list is complete
-- from the first day. The after-insert trigger (scoring, "activity logged"
-- workflows) is held off for the backfills below: these rows are records of
-- what already exists, not something that just happened.
alter table crm_activities disable trigger crm_activities_after_insert;
alter table crm_activities disable trigger crm_tasks_sync_follow_up;
insert into crm_activities (company_id, lead_id, type, direction, subject, due_at, assigned_to, priority, meta)
select l.company_id, l.id, 'task', 'none', 'Follow-up', l.follow_up_at, l.assigned_to, 'Normal', '{"auto": true}'::jsonb
  from crm_leads l
 where l.follow_up_at is not null and l.merged_into is null
   and not exists (select 1 from crm_activities a
                    where a.lead_id = l.id and a.type = 'task' and a.done_at is null and a.due_at = l.follow_up_at);

-- ── 5. the notes box becomes the first note ───────────────────
insert into crm_activities (company_id, lead_id, type, direction, body, created_at, meta)
select l.company_id, l.id, 'note', 'none', left(l.notes, 8000), l.created_at,
       '{"pinned": true, "migrated": true}'::jsonb
  from crm_leads l
 where nullif(trim(coalesce(l.notes, '')), '') is not null
   and not exists (select 1 from crm_activities a where a.lead_id = l.id and (a.meta->>'migrated') = 'true');

alter table crm_activities enable trigger crm_activities_after_insert;
alter table crm_activities enable trigger crm_tasks_sync_follow_up;

-- ── 6. one reminder per follow-up, not two ────────────────────
-- A follow-up is now both crm_leads.follow_up_at (alerted by
-- run_crm_followup_cron) and a task (alerted here). The split: a task 0209
-- made to stand behind a legacy follow-up date (meta.auto) is left to the
-- follow-up alert; a task someone wrote keeps its own alert, with its own
-- words ("Task due: Send the album proofs"), and the follow-up alert steps
-- aside for it below. Copied from 0151 with that one condition.
create or replace function crm_task_reminders(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_due int := 0;
  v_notified int := 0;
  v_to uuid;
begin
  for v_r in
    select a.id, a.company_id, a.subject, a.due_at, coalesce(a.assigned_to, l.assigned_to) as who,
           l.name as lead_name, l.phone, a.lead_id
    from crm_activities a
    left join crm_leads l on l.id = a.lead_id
    where a.type = 'task' and a.done_at is null and a.due_at is not null and a.due_at <= now()
      and coalesce(a.meta->>'auto', '') <> 'true'
  loop
    v_due := v_due + 1;
    if p_dry_run then continue; end if;
    v_to := crm_alert_recipient(v_r.company_id, v_r.who);
    if v_to is null then continue; end if;
    if create_notification(
         v_r.company_id, v_to, 'crm_task',
         'Task due: ' || coalesce(v_r.subject, 'follow up'),
         case when v_r.lead_name is not null or v_r.phone is not null then 'For ' || coalesce(v_r.lead_name, v_r.phone) else null end,
         'crm_task:' || v_r.id::text || ':' || current_date::text,
         'crm_lead', v_r.lead_id)
    then
      v_notified := v_notified + 1;
    end if;
  end loop;
  return jsonb_build_object('due', v_due, 'notified', v_notified);
end;
$$;
revoke all on function crm_task_reminders(boolean) from public, anon;
grant execute on function crm_task_reminders(boolean) to service_role;

-- run_crm_followup_cron: copied from its latest definition (0205). One change,
-- marked 0209: the per-lead "Follow-up overdue" alert is skipped when a
-- hand-written task stands at that time, because crm_task_reminders already
-- told them, in that task's words. Workflows and the unassigned digest are
-- unchanged.
create or replace function run_crm_followup_cron(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run uuid;
  v_r record;
  v_d record;
  v_overdue int := 0;
  v_notified int := 0;
  v_unassigned int := 0;
  v_digests int := 0;
  v_rules int := 0;
  v_to uuid;
  v_cadences jsonb;
  v_sla jsonb;
  v_tasks jsonb;
  v_quotes jsonb;
  v_workflows jsonb;
  v_cold jsonb;
  v_summary jsonb;
begin
  insert into cron_runs (job_name, dry_run) values ('crm_followup_cron', p_dry_run) returning id into v_run;

  v_cadences := crm_advance_cadences(p_dry_run);
  v_sla := crm_sla_sweep(p_dry_run);
  v_tasks := crm_task_reminders(p_dry_run);
  v_quotes := crm_expire_quotes(p_dry_run);
  v_cold := crm_cold_sweep(p_dry_run);

  for v_r in
    select l.id, l.company_id, l.assigned_to, l.name, l.phone, l.follow_up_at
    from crm_leads l
    where l.is_archived = false
      and l.status not in ('converted', 'lost')
      and l.follow_up_at is not null
      and l.follow_up_at < now()
  loop
    v_overdue := v_overdue + 1;
    if v_r.assigned_to is null then v_unassigned := v_unassigned + 1; end if;
    if p_dry_run then continue; end if;
    -- 0209: a hand-written task due at this very time alerts on its own.
    if v_r.assigned_to is not null and not exists (
         select 1 from crm_activities a
          where a.lead_id = v_r.id and a.type = 'task' and a.done_at is null
            and a.due_at = v_r.follow_up_at and coalesce(a.meta->>'auto', '') <> 'true') then
      if create_notification(
           v_r.company_id, v_r.assigned_to, 'crm_overdue',
           'Follow-up overdue: ' || coalesce(v_r.name, v_r.phone, 'unnamed lead'),
           'Promised for ' || to_char(v_r.follow_up_at, 'DD Mon HH24:MI'),
           'crm_overdue:' || v_r.id::text || ':' || current_date::text,
           'crm_lead', v_r.id)
      then
        v_notified := v_notified + 1;
      end if;
    end if;
    v_rules := v_rules + crm_enroll_workflows(v_r.id, 'follow_up_overdue', null);
  end loop;

  -- One line per company per day, and only when there is something to say.
  if not p_dry_run then
    for v_d in
      select l.company_id, count(*) as n
        from crm_leads l
       where l.is_archived = false
         and l.status not in ('converted', 'lost')
         and l.assigned_to is null
         and l.follow_up_at is not null
         and l.follow_up_at < now()
       group by l.company_id
    loop
      v_to := crm_alert_recipient(v_d.company_id, null);
      if v_to is not null then
        if create_notification(
             v_d.company_id, v_to, 'crm_overdue',
             v_d.n || case when v_d.n = 1 then ' overdue lead has nobody on it' else ' overdue leads have nobody on them' end,
             'They were promised a follow-up and are not assigned to anyone.',
             'crm_overdue_unassigned:' || current_date::text,
             null, null)
        then
          v_digests := v_digests + 1;
        end if;
      end if;
    end loop;
  end if;

  v_workflows := crm_run_workflows(p_dry_run);

  v_summary := jsonb_build_object('overdue', v_overdue, 'notified', v_notified,
                                  'unassigned', v_unassigned, 'digests', v_digests,
                                  'rules_applied', v_rules,
                                  'cadences', v_cadences, 'sla', v_sla, 'tasks', v_tasks,
                                  'quotes', v_quotes, 'workflows', v_workflows, 'cold', v_cold,
                                  'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;
