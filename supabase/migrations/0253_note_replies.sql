-- 0253: a reply to a note goes to whoever sent it.
--
-- deliverable_notes_notify (0180) told the editor when someone else wrote,
-- and when the editor wrote it told the project's creator -- so Asha's voice
-- note to Nitin got its answer delivered to whoever happened to make the
-- project, and Asha never heard back. Now the editor's note goes to the last
-- person who wrote to them on that deliverable (still in the studio), else to
-- whoever gave the work (deliverables.assigned_by, 0229), else to the
-- project's creator as before.
--
-- The editor's own alert opens their item on My work ("/my-work?d=<id>"), the
-- page that lets them listen and reply; the studio's people keep the project
-- link. Copied from 0180; copy it from here from now on.

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
  v_link     text;
begin
  if new.kind not in ('text', 'voice') then
    return new;
  end if;
  if coalesce(current_setting('ipc.quiet_note_notify', true), '') = '1' then
    return new;
  end if;
  select d.id, d.title, d.project_id, d.assignee_id, d.assigned_by, p.created_by, p.name as project_name
    into v_d
    from deliverables d join projects p on p.id = d.project_id
   where d.id = new.deliverable_id;
  if v_d.id is null then
    return new;
  end if;

  if v_d.assignee_id is not null and v_d.assignee_id is distinct from new.author_id then
    -- Someone wrote to the editor.
    v_to := v_d.assignee_id;
    v_link := '/my-work?d=' || v_d.id;
  elsif v_d.assignee_id is not distinct from new.author_id and new.author_id is not null then
    -- The editor answered: to whoever last wrote to them, if still here.
    select n.author_id into v_to
      from deliverable_notes n
      join users u on u.user_id = n.author_id and u.company_id = new.company_id
                  and u.deleted_at is null and u.status = 'active'
     where n.deliverable_id = new.deliverable_id
       and n.id <> new.id
       and n.kind in ('text', 'voice')
       and n.author_id is distinct from new.author_id
     order by n.created_at desc
     limit 1;
    v_to := coalesce(v_to, v_d.assigned_by, v_d.created_by);
    v_link := '/projects/' || v_d.project_id || '?tab=deliverables&d=' || v_d.id;
  end if;
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
    v_link);
  return new;
end;
$$;
