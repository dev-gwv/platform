-- 0180: sent back for changes, revised, handed in again.
--
-- Work comes back to an editor in one of two ways. A reviewer sends a
-- submission back, which 0166 turns into Editing · Changes requested with the
-- reviewer's words in the timeline; or a manager moves the deliverable to
-- "Changes requested" by hand. Until now the first reached the editor only as
-- "Sana left a note on Film" -- and not at all when the reviewer wrote
-- nothing -- and the second did not reach them at all. Both now end the same
-- way:
--
--   1. A deliverable's submissions count up -- version 1, 2, 3 -- so a
--      revision is always the last version plus one. It goes to Review ·
--      With manager like the first one did (0166 already does that).
--   2. deliverable_revision_state(): is it back with the editor, what did the
--      reviewer say, which version was the last -- for the editor's own list.
--   3. One notification, "Changes requested: <title>", with what the reviewer
--      said, opening My Work. Once per version: sent back, moved by hand, or
--      both, the editor hears about it once.

-- ── 1. versions count up ──────────────────────────────────────────
-- Every hand-in was version 1: the column (0104) has a default and nothing
-- ever set it. A deliverable's submissions now number themselves, on from the
-- highest so far, so the ones already made keep the number they showed.
create or replace function team_work_submissions_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deliverable_id is null then
    return new;
  end if;
  -- Hold the deliverable while counting, so two hand-ins at the same moment
  -- queue up instead of both becoming the same version.
  perform 1 from deliverables where id = new.deliverable_id for update;
  new.version := coalesce(
    (select max(w.version) from team_work_submissions w where w.deliverable_id = new.deliverable_id),
    0) + 1;
  return new;
end;
$$;

-- Triggers of one kind run in name order, so this comes after
-- team_work_submissions_fill has checked the deliverable is this studio's.
drop trigger if exists team_work_submissions_version on team_work_submissions;
create trigger team_work_submissions_version
  before insert on team_work_submissions
  for each row execute function team_work_submissions_version();

-- ── 2. where a deliverable stands with its editor ─────────────────
-- Back with the editor: on "Changes requested" -- or in Editing with no stage
-- named, when the studio has removed that stage and its last version was sent
-- back. What the reviewer said: the newest of the note a version was sent
-- back with and the written notes others left on it, since the work last went
-- for review -- older words were about older work. Runs as the caller, so it
-- reads only what they may.
create or replace function deliverable_revision_state(p_deliverable uuid)
returns table (changes_requested boolean, review_note text, last_version int)
language sql
stable
set search_path = public
as $$
  with d as (
    select id, status, custom_status_code, assignee_id
      from deliverables
     where id = p_deliverable
  ),
  latest as (
    select w.status, w.version, w.created_at
      from team_work_submissions w
     where w.deliverable_id = p_deliverable
     order by w.created_at desc, w.version desc
     limit 1
  ),
  -- Handed in through the app, or moved to a review stage with a button.
  went_for_review as (
    select greatest(
      (select l.created_at from latest l),
      (select max(n.created_at) from deliverable_notes n
        where n.deliverable_id = p_deliverable and n.kind = 'event' and n.body like 'moved:review%')
    ) as at
  ),
  said as (
    select w.review_notes as body, coalesce(w.reviewed_at, w.updated_at) as at
      from team_work_submissions w
     where w.deliverable_id = p_deliverable and w.status = 'rejected'
       and nullif(btrim(coalesce(w.review_notes, '')), '') is not null
    union all
    select n.body, n.created_at
      from deliverable_notes n
      join d on true
     where n.deliverable_id = p_deliverable and n.kind = 'text'
       and n.author_id is distinct from d.assignee_id
  )
  select
    coalesce(
      d.status = 'in_progress'
        and (d.custom_status_code = 'changes_requested'
             or (d.custom_status_code is null and (select l.status from latest l) = 'rejected')),
      false),
    (select s.body
       from said s
      where s.at >= coalesce((select g.at from went_for_review g), '-infinity'::timestamptz)
      order by s.at desc
      limit 1),
    (select l.version from latest l)
  from d
$$;
revoke all on function deliverable_revision_state(uuid) from public, anon;
grant execute on function deliverable_revision_state(uuid) to authenticated, service_role;

-- ── 3. telling the editor, once ───────────────────────────────────
-- p_submission is the version a reviewer sent back; null when the deliverable
-- was moved to "Changes requested" by hand. The editor on it hears, and so
-- does whoever made that version if it was someone else -- never the person
-- who sent it back.
create or replace function notify_changes_requested(p_deliverable uuid, p_submission uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d         record;
  v_sub       uuid;
  v_status    text;
  v_submitter uuid;
  v_note      text;
  v_to        uuid;
begin
  select d.id, d.company_id, d.title, d.project_id, d.assignee_id, p.name as project_name
    into v_d
    from deliverables d
    join projects p on p.id = d.project_id
   where d.id = p_deliverable;
  if v_d.id is null then
    return;
  end if;

  if p_submission is not null then
    select w.id, w.submitted_by, nullif(btrim(coalesce(w.review_notes, '')), '')
      into v_sub, v_submitter, v_note
      from team_work_submissions w
     where w.id = p_submission;
  else
    -- Moved back by hand while its latest version was waiting for review:
    -- that version is the one going back, and a review of it afterwards must
    -- not tell the editor a second time.
    select w.id, w.status into v_sub, v_status
      from team_work_submissions w
     where w.deliverable_id = p_deliverable
     order by w.created_at desc
     limit 1;
    if v_status is distinct from 'submitted' then
      v_sub := null;
    end if;
  end if;
  if v_note is null then
    select s.review_note into v_note from deliverable_revision_state(p_deliverable) s;
  end if;

  for v_to in
    select distinct r
      from unnest(array[v_d.assignee_id, v_submitter]) as r
     where r is not null and r is distinct from p_actor
  loop
    perform create_notification(
      v_d.company_id, v_to, 'deliverable_changes_requested',
      'Changes requested: ' || v_d.title,
      v_d.project_name || ' · ' || coalesce(left(v_note, 200), 'Open My Work to see what to change.'),
      -- Once per version sent back. Work never handed in through the app has
      -- no version: then once per move.
      'changes_requested:' || coalesce(v_sub::text, v_d.id::text || ':' || txid_current()::text),
      'deliverable', v_d.id, 'warning', '/my-work',
      jsonb_build_object('project_id', v_d.project_id, 'submission_id', v_sub));
  end loop;
end;
$$;
revoke all on function notify_changes_requested(uuid, uuid, uuid) from public, anon, authenticated;

-- A note that goes with work sent back is carried by the notification above,
-- so the note itself stays quiet (ipc.quiet_note_notify). Otherwise as 0165.
create or replace function deliverable_notes_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_d        record;
  v_author   text;
  v_to       uuid;
begin
  if new.kind not in ('text', 'voice') then
    return new;
  end if;
  if coalesce(current_setting('ipc.quiet_note_notify', true), '') = '1' then
    return new;
  end if;
  select d.id, d.title, d.project_id, d.assignee_id, p.created_by, p.name as project_name
    into v_d
    from deliverables d join projects p on p.id = d.project_id
   where d.id = new.deliverable_id;
  if v_d.id is null then
    return new;
  end if;

  v_to := case
    when v_d.assignee_id is not null and v_d.assignee_id is distinct from new.author_id then v_d.assignee_id
    when v_d.assignee_id is not distinct from new.author_id then v_d.created_by
    else null
  end;
  if v_to is null or v_to is not distinct from new.author_id then
    return new;
  end if;

  select name into v_author from users where user_id = new.author_id;
  perform create_notification(
    new.company_id, v_to, 'deliverable_note',
    case when new.kind = 'voice'
      then coalesce(v_author, 'Someone') || ' sent a voice note on ' || v_d.title
      else coalesce(v_author, 'Someone') || ' left a note on ' || v_d.title end,
    case when new.kind = 'voice'
      then coalesce(v_d.project_name, '') || ' · tap to listen'
      else coalesce(v_d.project_name, '') || ' · ' || left(coalesce(new.body, ''), 120) end,
    'deliverable_note:' || new.id,
    'deliverable', v_d.id, 'info',
    '/projects/' || v_d.project_id || '?tab=deliverables&d=' || v_d.id);
  return new;
end;
$$;

-- Sending work back: as 0166, plus the one notification.
create or replace function team_work_submissions_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deliverable_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    perform deliverable_follow_submission(new.deliverable_id, 'review', 'with_manager',
      new.submission_link, 'submitted:' || new.id, coalesce(new.submitted_by, auth.uid()));
    return new;
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'approved' then
    perform deliverable_follow_submission(new.deliverable_id, 'review', 'approved',
      null, 'approved:' || new.id, auth.uid());
  elsif new.status = 'rejected' then
    perform deliverable_follow_submission(new.deliverable_id, 'in_progress', 'changes_requested',
      null, 'sent_back:' || new.id, auth.uid());
    -- What the reviewer said stays in the deliverable's timeline, where the
    -- editor can read it again.
    if nullif(btrim(coalesce(new.review_notes, '')), '') is not null and auth.uid() is not null then
      perform set_config('ipc.quiet_note_notify', '1', true);
      insert into deliverable_notes (company_id, deliverable_id, author_id, kind, body)
      values (new.company_id, new.deliverable_id, auth.uid(), 'text', left(new.review_notes, 4000));
      perform set_config('ipc.quiet_note_notify', '', true);
    end if;
    perform notify_changes_requested(new.deliverable_id, new.id, auth.uid());
  elsif new.status = 'sent' then
    perform deliverable_follow_submission(new.deliverable_id, 'review', 'with_client',
      null, 'sent_to_client:' || new.id, auth.uid());
  elsif new.status = 'submitted' and old.status = 'rejected' then
    perform deliverable_follow_submission(new.deliverable_id, 'review', 'with_manager',
      new.submission_link, 'resubmitted:' || new.id, coalesce(new.submitted_by, auth.uid()));
  end if;
  return new;
end;
$$;

-- Moved to "Changes requested" by hand: the same notification. A reviewer
-- sending a version back moves it quietly (0166) and says so itself.
create or replace function deliverables_changes_requested()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'in_progress' and new.custom_status_code = 'changes_requested'
     and not (old.status = 'in_progress' and old.custom_status_code is not distinct from 'changes_requested')
     and coalesce(current_setting('ipc.quiet_stage_log', true), '') <> '1' then
    perform notify_changes_requested(new.id, null, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists deliverables_changes_requested on deliverables;
create trigger deliverables_changes_requested
  after update on deliverables
  for each row execute function deliverables_changes_requested();
