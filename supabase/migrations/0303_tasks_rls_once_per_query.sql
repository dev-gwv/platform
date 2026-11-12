-- 0303: speed (11-12 Nov). The tasks list still spent ~250 ms on a busy
-- studio: tasks_write ("company_id = get_current_company_id() AND
-- is_current_admin_or_manager()", FOR ALL, so it also applies to reads) and
-- tasks_insert_own kept their bare helper calls, which run once per row.
--
-- 0302 left every plain policy alone on a table another policy reads in a
-- sub-query, so as not to trip Postgres's "infinite recursion in policy"
-- guard. That guard only fires for a table whose applicable policies carry a
-- sub-query, and tasks' own select policy already carries one (it looks into
-- task_assignees), so wrapping its other policies adds nothing new for it.
-- task_assignees, projects, clients, crm_leads and crm_automation_rules have
-- no sub-query yet and stay as 0302 left them.
--
-- Same in-place rewrite as 0302, limited to tasks. Safe to run twice.

do $$
declare
  p record;
  pat constant text := '(?<!SELECT )\m((?:public\.|auth\.)?(?:get_current_company_id|is_current_user_active|is_current_owner|is_current_admin_or_manager|is_platform_admin|uid))\(\)';
  new_qual text;
  new_check text;
  stmt text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = 'tasks'
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ pat
  loop
    new_qual := case when p.qual is null then null else regexp_replace(p.qual, pat, '(SELECT \1())', 'g') end;
    new_check := case when p.with_check is null then null else regexp_replace(p.with_check, pat, '(SELECT \1())', 'g') end;
    new_qual := replace(new_qual, '(SELECT uid())', 'uid()');
    new_check := replace(new_check, '(SELECT uid())', 'uid()');
    if new_qual is not distinct from p.qual and new_check is not distinct from p.with_check then
      continue;
    end if;
    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if new_qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if new_check is not null then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;
    execute stmt;
  end loop;
end
$$;
