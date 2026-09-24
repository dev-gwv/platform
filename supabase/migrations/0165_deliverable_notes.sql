-- Notes and voice notes on a deliverable, and its history.
--
-- A deliverable used to carry one brief and nothing else: no way to tell the
-- editor "warmer tones on the reception", no record of who moved it to "With
-- client" or when. This is that conversation, one timeline per deliverable:
--
--   text   a written note
--   voice  a recorded voice note (the audio lives in `files`)
--   event  written by the database itself when the stage changes
--
-- Posting a note tells the other side: the editor when someone else writes,
-- the project's owner when the editor writes. So "send the editor a voice
-- note" is: record, send -- they get a notification and hear it in My Work.

create table if not exists deliverable_notes (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies (id) on delete cascade,
  deliverable_id   uuid not null references deliverables (id) on delete cascade,
  author_id        uuid references auth.users (id) on delete set null,
  kind             text not null check (kind in ('text', 'voice', 'event')),
  body             text check (body is null or length(body) <= 4000),
  file_id          uuid references files (id) on delete set null,
  duration_seconds int check (duration_seconds is null or duration_seconds between 0 and 3600),
  created_at       timestamptz not null default now(),
  -- A voice note is its recording; a written note is its words.
  constraint deliverable_notes_voice_has_file check (kind <> 'voice' or file_id is not null),
  constraint deliverable_notes_text_has_body check (kind <> 'text' or length(btrim(coalesce(body, ''))) > 0)
);

create index if not exists deliverable_notes_timeline_idx
  on deliverable_notes (deliverable_id, created_at);
create index if not exists deliverable_notes_company_idx
  on deliverable_notes (company_id);

-- ── fill in what the caller should not have to say ─────────────────
-- The company comes from the deliverable, never from the caller, and a
-- recording must be one of this studio's own files.
create or replace function deliverable_notes_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_company uuid;
begin
  select company_id into v_company from deliverables where id = new.deliverable_id;
  if v_company is null then
    raise exception 'deliverable not found' using errcode = '23503';
  end if;
  new.company_id := v_company;
  if new.author_id is null and new.kind <> 'event' then
    new.author_id := auth.uid();
  end if;
  if new.file_id is not null
     and not exists (select 1 from files where id = new.file_id and company_id = v_company) then
    raise exception 'file not in this studio' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists deliverable_notes_fill on deliverable_notes;
create trigger deliverable_notes_fill
  before insert on deliverable_notes
  for each row execute function deliverable_notes_fill();

alter table deliverable_notes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'deliverable_notes_select') then
    create policy deliverable_notes_select on deliverable_notes for select to authenticated
      using (company_id = get_current_company_id());
  end if;
  -- People write text and voice notes as themselves. Events come only from
  -- the stage trigger below, which runs as the table owner.
  if not exists (select 1 from pg_policies where policyname = 'deliverable_notes_insert') then
    create policy deliverable_notes_insert on deliverable_notes for insert to authenticated
      with check (
        company_id = get_current_company_id()
        and is_current_user_active()
        and author_id = auth.uid()
        and kind in ('text', 'voice')
      );
  end if;
  if not exists (select 1 from pg_policies where policyname = 'deliverable_notes_delete') then
    create policy deliverable_notes_delete on deliverable_notes for delete to authenticated
      using (
        company_id = get_current_company_id()
        and kind <> 'event'
        and (author_id = auth.uid() or is_current_admin_or_manager())
      );
  end if;
end $$;

grant select, insert, delete on deliverable_notes to authenticated;

-- ── the stage history writes itself ───────────────────────────────
create or replace function deliverables_log_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;
  insert into deliverable_notes (company_id, deliverable_id, author_id, kind, body)
  values (new.company_id, new.id, auth.uid(), 'event', 'moved:' || new.status);
  return new;
end;
$$;

drop trigger if exists deliverables_log_stage on deliverables;
create trigger deliverables_log_stage
  after update of status on deliverables
  for each row execute function deliverables_log_stage();

-- ── tell the other side ───────────────────────────────────────────
-- The editor hears about notes others leave; when the editor writes, the
-- project's creator hears about it. Nobody is notified of their own note.
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

drop trigger if exists deliverable_notes_notify on deliverable_notes;
create trigger deliverable_notes_notify
  after insert on deliverable_notes
  for each row execute function deliverable_notes_notify();
