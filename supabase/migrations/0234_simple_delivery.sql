-- 0234: Simple delivery mode. A studio picks how finished work reaches
-- Delivered (`companies.delivery_flow`):
--
--   full   -- the editor hands in, a manager reviews, then it is delivered
--             (every studio until now, and still the default);
--   simple -- a hand-in is approved and Delivered the moment it lands. The
--             board reads To do · Editing · Delivered. A manager can still
--             send it back, which reopens Editing as before.
--
-- Review is enforced here, not in the app: in a Full studio every hand-in is
-- forced to review_required = true, whatever the request said, so an editor
-- can never skip review by posting review_required: false.
--
-- team_work_submissions_follow is copied from 0180 (the latest) and only
-- gains the Simple branch on INSERT and the link fix on UPDATE.

alter table companies add column if not exists delivery_flow text not null default 'full'
  check (delivery_flow in ('full', 'simple'));

comment on column companies.delivery_flow is
  'full: hand-ins go to review; simple: a hand-in is approved and Delivered as it lands (0234).';

-- ── the flow decides a hand-in's review, before it is written ────────
create or replace function team_work_submissions_flow()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_flow text;
begin
  select delivery_flow into v_flow from companies where id = new.company_id;
  -- An editor's own insert can never arrive already reviewed.
  if current_user = 'authenticated' and not is_current_admin_or_manager() then
    new.status := 'submitted';
  end if;
  if coalesce(v_flow, 'full') = 'simple' then
    if new.status = 'submitted' then
      new.review_required := false;
      new.status := 'approved';
      new.reviewed_at := coalesce(new.reviewed_at, now());
    end if;
  else
    new.review_required := true;
  end if;
  return new;
end;
$$;
revoke all on function team_work_submissions_flow() from public;

drop trigger if exists team_work_submissions_flow on team_work_submissions;
create trigger team_work_submissions_flow
  before insert on team_work_submissions
  for each row execute function team_work_submissions_flow();

-- ── an editor may fix the link on a hand-in that skipped review ───────
-- tws_update (0139) allowed edits only while 'submitted'. A Simple hand-in is
-- approved as it lands, so its editor could never correct a wrong link. The
-- policy now also opens an approved hand-in that never needed review; the
-- guard below keeps everyone but a manager off its status and review fields.
drop policy if exists tws_update on team_work_submissions;
create policy tws_update on team_work_submissions
  for update to authenticated
  using (
    company_id = get_current_company_id()
    and (status = 'submitted' or (status = 'approved' and review_required = false))
    and (is_current_admin_or_manager() or submitted_by = auth.uid())
  )
  with check (
    company_id = get_current_company_id()
    and (is_current_admin_or_manager() or submitted_by = auth.uid())
  );

create or replace function team_work_submissions_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Definer functions (review_work, deliver_work_to_client, revoke) run as
  -- their owner and are the managers' way in; a plain editor's update keeps
  -- what the review said.
  if current_user = 'authenticated' and not is_current_admin_or_manager() then
    new.status := old.status;
    new.review_required := old.review_required;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.review_notes := old.review_notes;
  end if;
  return new;
end;
$$;

drop trigger if exists team_work_submissions_guard on team_work_submissions;
create trigger team_work_submissions_guard
  before update on team_work_submissions
  for each row execute function team_work_submissions_guard();

-- ── the deliverable follows (copied from 0180) ────────────────────────
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
    if new.status = 'approved' and not new.review_required then
      -- Simple delivery: handed in is delivered.
      perform deliverable_follow_submission(new.deliverable_id, 'completed', 'delivered',
        new.submission_link, 'delivered:' || new.id, coalesce(new.submitted_by, auth.uid()));
    else
      perform deliverable_follow_submission(new.deliverable_id, 'review', 'with_manager',
        new.submission_link, 'submitted:' || new.id, coalesce(new.submitted_by, auth.uid()));
    end if;
    return new;
  end if;

  if old.status is not distinct from new.status then
    -- A corrected link on a hand-in that is already delivered follows it.
    if new.status = 'approved' and not new.review_required
       and nullif(btrim(coalesce(new.submission_link, '')), '') is not null
       and new.submission_link is distinct from old.submission_link then
      update deliverables set delivery_link = new.submission_link where id = new.deliverable_id;
    end if;
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

-- It also follows a corrected link, not only a change of status.
drop trigger if exists team_work_submissions_follow on team_work_submissions;
create trigger team_work_submissions_follow
  after insert or update of status, submission_link on team_work_submissions
  for each row execute function team_work_submissions_follow();
