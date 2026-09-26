-- 0191: Studio setup state -- a new studio is walked through three steps
-- (add your team, add your first client, create your first project), one at a
-- time, and the walk ends for good once it is done or skipped.
--
--   setup_done_at     stamped when the third step is finished (or the studio
--                     is found to have all three already).
--   setup_skipped_at  stamped when the owner or an admin chose "Skip setup".
--
-- Either one being set means setup is over. Both stay null for a studio that
-- is still being set up.
--
-- companies is updatable by the owner only (companies_update_owner, 0003),
-- but an admin can also be the one standing a studio up, so the write goes
-- through mark_studio_setup(), which checks the caller itself and touches
-- nothing but these two columns.

alter table companies
  add column if not exists setup_done_at    timestamptz,
  add column if not exists setup_skipped_at timestamptz;

-- A studio that was already running before this shipped is not new: one with
-- a project on the books does not get walked through setup on its next login.
update companies c
   set setup_done_at = now()
 where c.setup_done_at is null
   and c.setup_skipped_at is null
   and exists (select 1 from projects p where p.company_id = c.id);

/**
 * Where the caller's studio is in setup.
 *
 *   done  setup is over: done or skipped, or the studio already has a
 *         teammate, a client and a project (counts as done automatically).
 *   step  the first of the three steps still outstanding (1, 2 or 3), or null
 *         when all three are satisfied.
 *
 * A teammate is anyone active on the studio other than its owner -- the owner
 * exists from registration, so counting them would tick step 1 off at once.
 */
create or replace function studio_setup_state()
returns table (done boolean, step int)
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select id, owner_user_id, setup_done_at, setup_skipped_at
      from companies
     where id = get_current_company_id()
  ), s as (
    select c.*,
           exists (select 1 from users u
                    where u.company_id = c.id and u.deleted_at is null
                      and u.status = 'active' and u.user_id <> c.owner_user_id) as has_team,
           exists (select 1 from clients cl where cl.company_id = c.id) as has_client,
           exists (select 1 from projects p where p.company_id = c.id) as has_project
      from c
  )
  select (setup_done_at is not null or setup_skipped_at is not null
          or (has_team and has_client and has_project)) as done,
         case when not has_team then 1
              when not has_client then 2
              when not has_project then 3
         end as step
    from s
$$;

/**
 * Close setup for the caller's studio: 'done' or 'skip'. Owner, super admin
 * or admin only. Idempotent -- the first stamp stands. Returns false when the
 * caller may not do this.
 */
create or replace function mark_studio_setup(p_action text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_action not in ('done', 'skip') then
    raise exception 'unknown setup action %', p_action using errcode = '22023';
  end if;
  if not (is_current_owner() or current_app_role() in ('super_admin', 'admin')) then
    return false;
  end if;
  update companies
     set setup_done_at    = case when p_action = 'done' then coalesce(setup_done_at, now()) else setup_done_at end,
         setup_skipped_at = case when p_action = 'skip' then coalesce(setup_skipped_at, now()) else setup_skipped_at end
   where id = get_current_company_id();
  return found;
end
$$;

revoke all on function studio_setup_state() from public, anon;
revoke all on function mark_studio_setup(text) from public, anon;
grant execute on function studio_setup_state() to authenticated;
grant execute on function mark_studio_setup(text) to authenticated;
