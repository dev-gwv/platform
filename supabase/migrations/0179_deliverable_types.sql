-- Deliverable types: the studio's own list of what it delivers -- "Photo
-- album: the client gets it 90 days after the wedding, the work needs 20
-- days" -- in place of the built-in guesses by name.
--
--   * deliverable_templates (0109, unused until now) is that list. It gains
--     work_days: how many days of work the thing needs.
--   * One live type per name in a studio, ignoring case -- unless old rows
--     already repeat one. Archived rows may repeat: adding the name again
--     brings the archived one back rather than making a second.
--   * Only admins and managers change the list (it was any active user).
--     Everyone in the studio still reads it: new deliverables are filled in
--     from it.
--   * company_work_days() / company_start_by(): deliverable_work_days() and
--     deliverable_start_by() (0174) with the studio's list in between -- the
--     deliverable's own lead first, then the studio's work days for that
--     name, then the built-in guess. "My deliverables" reads them.

alter table deliverable_templates
  add column if not exists work_days int check (work_days is null or work_days between 0 and 365);

comment on column deliverable_templates.work_days is
  'Days of work this deliverable needs. Start reminders count back from the due date by this.';

-- ── who can change the list ──────────────────────────────────────
drop policy if exists deliverable_templates_write on deliverable_templates;
create policy deliverable_templates_write on deliverable_templates
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager())
  with check (company_id = get_current_company_id() and is_current_admin_or_manager());

-- One live "Album" per studio, ignoring case -- unless old data already repeats one.
do $$ begin
  if not exists (
    select 1 from deliverable_templates where not is_archived
     group by company_id, lower(btrim(title)) having count(*) > 1
  ) then
    create unique index if not exists deliverable_templates_company_title_uidx
      on deliverable_templates (company_id, lower(btrim(title))) where not is_archived;
  end if;
end $$;

-- ── how many days the work needs, the studio's word first ────────
-- The deliverable's own lead wins: someone set it for this one project.
-- Then the studio's type of the same name, then the built-in guess. A type
-- with no work days set says nothing, so the guess still answers.
create or replace function company_work_days(p_company uuid, p_title text, p_lead int)
returns int
language sql
stable
set search_path = public
as $$
  select case
    when p_lead > 0 then p_lead
    else coalesce(
      (select t.work_days
         from deliverable_templates t
        where t.company_id = p_company
          and not t.is_archived
          and t.work_days is not null
          and lower(btrim(t.title)) = lower(btrim(p_title))
        order by t.created_at
        limit 1),
      deliverable_work_days(p_title, null))
  end
$$;

-- The day to begin: due, minus the work, minus a day for review.
create or replace function company_start_by(p_company uuid, p_due date, p_title text, p_lead int)
returns date
language sql
stable
set search_path = public
as $$
  select case when p_due is null then null
              else p_due - company_work_days(p_company, p_title, p_lead) - 1 end
$$;
