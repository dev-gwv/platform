-- The nightly absent sweep marked the wrong day and the wrong people.
--
-- It runs at 18:30 UTC -- midnight in India -- and took "today" in the
-- studio's zone, which by then is the day that has just begun. So every
-- evening it marked everyone absent for tomorrow, before anyone could check
-- in. It now marks the day that just ended (12 hours back from the run).
--
-- It also marked the studio owner, people with no login (who cannot check in)
-- and freelancers (who are not expected in the office). Only in-house staff
-- with a login are marked now. The auto check-in RPC, which marked someone
-- present from anywhere without the location check, is removed.

create or replace function mark_absent_backstop()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company companies;
  v_tz      text;
  v_date    date;
  v_added   int := 0;
  v_total   int := 0;
begin
  for v_company in select * from companies loop
    select timezone into v_tz from company_location where company_id = v_company.id;
    v_tz := coalesce(v_tz, 'Asia/Kolkata');
    -- The day that has just ended where the studio is.
    v_date := ((now() at time zone v_tz) - interval '12 hours')::date;
    insert into attendance (company_id, user_id, a_date, status)
      select v_company.id, u.user_id, v_date, 'absent'
      from users u
      where u.company_id = v_company.id and u.deleted_at is null and u.status = 'active'
        and u.role <> 'super_admin'
        and coalesce(u.login_enabled, true)
        and coalesce(u.engagement_type, 'in_house') = 'in_house'
        and u.created_at::date <= v_date
        and not exists (
          select 1 from attendance a
          where a.company_id = v_company.id and a.user_id = u.user_id and a.a_date = v_date
        )
      on conflict (company_id, user_id, a_date) do nothing;
    get diagnostics v_added = row_count;
    v_total := v_total + v_added;
  end loop;
  return v_total;
end;
$$;
revoke all on function mark_absent_backstop() from public, anon;
grant execute on function mark_absent_backstop() to service_role;

drop function if exists auto_check_in();
