-- 0302: speed (audit, 11 Nov). Row-level security policies call the studio
-- helpers once per query instead of once per row.
--
-- Every policy compares rows with get_current_company_id(),
-- is_current_user_active(), is_current_owner(), is_current_admin_or_manager(),
-- is_platform_admin() or auth.uid(). They are STABLE but SECURITY DEFINER, so
-- Postgres cannot inline them, and where a scan is not on company_id it ran
-- them as a filter on every row: reading a studio's 2,400 tasks took ~70 ms,
-- and ~3 ms once the calls were wrapped as (select fn()), which Postgres
-- evaluates once and reuses (an InitPlan). None of them takes an argument or
-- reads the row, so the answer is the same either way.
--
-- Rather than restate ~300 policies by hand (and risk rebuilding one from an
-- older body), each live policy is rewritten in place from its own current
-- expression. Safe to run twice: a call already inside "SELECT " is skipped.
-- A policy added later should write (select get_current_company_id()) itself.
--
-- One exception. Postgres refuses a policy cycle ("infinite recursion detected
-- in policy") only when the policy it meets again carries a sub-query, and
-- (select fn()) is one. tasks' policy looks into task_assignees and
-- task_assignees' looks back into tasks; wrapping task_assignees' plain
-- "company_id = get_current_company_id()" would make every insert there fail.
-- So a policy that has no sub-query today is left as it is when its table is
-- read from inside another policy's sub-query. Those are plain company
-- checks on small tables, served by the company index anyway.

do $$
declare
  p record;
  pat constant text := '(?<!SELECT )\m((?:public\.|auth\.)?(?:get_current_company_id|is_current_user_active|is_current_owner|is_current_admin_or_manager|is_platform_admin|uid))\(\)';
  new_qual text;
  new_check text;
  stmt text;
  looked_into text[];
begin
  -- Every table some policy reads inside a sub-query.
  select coalesce(array_agg(distinct m[1]), '{}')
    into looked_into
    from pg_policies,
         regexp_matches(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                        '(?:FROM|JOIN)\s+(?:public\.)?([a-z_][a-z0-9_]*)', 'g') m;

  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ pat
  loop
    if p.tablename = any (looked_into)
       and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') !~ 'SELECT' then
      continue;
    end if;
    new_qual := case when p.qual is null then null else regexp_replace(p.qual, pat, '(SELECT \1())', 'g') end;
    new_check := case when p.with_check is null then null else regexp_replace(p.with_check, pat, '(SELECT \1())', 'g') end;
    -- A bare uid() is only auth.uid() when it came from the auth schema; the
    -- deparser writes it qualified, so an unqualified uid() is left alone.
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
