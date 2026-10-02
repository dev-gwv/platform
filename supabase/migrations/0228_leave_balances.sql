-- 0228: leave balances. A studio sets how many days of each kind a person
-- gets a year (casual, sick, paid); everyone sees "8 of 12 casual left",
-- and whoever approves sees the balance before they say yes -- with
-- "Approve as unpaid" when the days have run out.
--
-- A day off (holiday, weekly off) inside a leave is not counted against it;
-- a half day is 0.5. The year is the calendar year. Unpaid and "other"
-- leave have no allowance.

create table if not exists leave_allowances (
  company_id    uuid not null references companies (id) on delete cascade default get_current_company_id(),
  kind          text not null check (kind in ('casual', 'sick', 'paid')),
  days_per_year numeric(5, 1) not null check (days_per_year >= 0 and days_per_year <= 365),
  updated_at    timestamptz not null default now(),
  primary key (company_id, kind)
);
alter table leave_allowances enable row level security;
drop policy if exists leave_allowances_select on leave_allowances;
create policy leave_allowances_select on leave_allowances
  for select to authenticated
  using (company_id = get_current_company_id());
drop policy if exists leave_allowances_write on leave_allowances;
create policy leave_allowances_write on leave_allowances
  for all to authenticated
  using (company_id = get_current_company_id() and is_current_admin_or_manager())
  with check (company_id = get_current_company_id() and is_current_admin_or_manager());
grant select, insert, update, delete on leave_allowances to authenticated;

-- How many days a leave takes: working days only, a half day is 0.5.
create or replace function leave_days(p_company uuid, p_start date, p_end date, p_half boolean)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
           when coalesce(p_half, false) then case when day_off(p_company, p_start) is null then 0.5 else 0 end
           else (select count(*)::numeric from generate_series(p_start, p_end, interval '1 day') d
                  where day_off(p_company, d::date) is null)
         end
$$;
revoke all on function leave_days(uuid, date, date, boolean) from public, anon;
grant execute on function leave_days(uuid, date, date, boolean) to authenticated, service_role;

-- Each person's balance for each kind with an allowance, for one year.
-- Your own always; everyone's for an owner, admin or manager.
create or replace function leave_balances(p_year int default null, p_user uuid default null)
returns table (
  user_id    uuid,
  user_name  text,
  kind       text,
  allowance  numeric,
  used       numeric,
  pending    numeric,
  remaining  numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with yr as (
    select coalesce(p_year, extract(year from (now() at time zone 'Asia/Kolkata'))::int) as y
  ), who as (
    select u.user_id, u.name
      from users u
     where u.company_id = get_current_company_id()
       and u.deleted_at is null and u.status = 'active'
       and coalesce(u.engagement_type, 'in_house') <> 'freelancer'
       and (u.user_id = auth.uid() or is_current_admin_or_manager())
       and (p_user is null or u.user_id = p_user)
  ), taken as (
    select lr.user_id, lr.kind, lr.status,
           sum(leave_days(lr.company_id,
                          greatest(lr.start_date, make_date((select y from yr), 1, 1)),
                          least(lr.end_date, make_date((select y from yr), 12, 31)),
                          lr.half_day)) as days
      from leave_requests lr
     where lr.company_id = get_current_company_id()
       and lr.status in ('approved', 'pending')
       and lr.start_date <= make_date((select y from yr), 12, 31)
       and lr.end_date >= make_date((select y from yr), 1, 1)
     group by lr.user_id, lr.kind, lr.status
  )
  select w.user_id, w.name, a.kind, a.days_per_year,
         coalesce((select t.days from taken t where t.user_id = w.user_id and t.kind = a.kind and t.status = 'approved'), 0),
         coalesce((select t.days from taken t where t.user_id = w.user_id and t.kind = a.kind and t.status = 'pending'), 0),
         a.days_per_year - coalesce((select t.days from taken t where t.user_id = w.user_id and t.kind = a.kind and t.status = 'approved'), 0)
    from who w
    cross join leave_allowances a
   where a.company_id = get_current_company_id()
   order by w.name, case a.kind when 'casual' then 1 when 'sick' then 2 else 3 end
$$;
revoke all on function leave_balances(int, uuid) from public, anon;
grant execute on function leave_balances(int, uuid) to authenticated;

-- decide_leave (copied from 0177) gains p_as_unpaid: approve it, with the
-- days past what is left of that kind's allowance as unpaid leave. The
-- request keeps the days still covered (whole working days, in order) and a
-- second, approved unpaid request takes the rest; with nothing left, the
-- whole request becomes unpaid.
drop function if exists decide_leave(uuid, boolean, text);
create or replace function decide_leave(p_id uuid, p_approve boolean, p_note text, p_as_unpaid boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r       leave_requests;
  v_unpaid  boolean := p_approve and coalesce(p_as_unpaid, false);
  v_left    numeric;
  v_keep    int;
  v_cut     date;
  v_split   boolean := false;
begin
  if not (is_current_user_active() and is_current_admin_or_manager()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_r from leave_requests where id = p_id and company_id = get_current_company_id();
  if not found then
    raise exception 'leave request not found' using errcode = 'P0002';
  end if;
  if v_r.status <> 'pending' then
    raise exception 'this request was already decided' using errcode = '22023';
  end if;
  if v_r.user_id = auth.uid() and not is_current_owner() then
    raise exception 'someone else has to decide your own leave' using errcode = '42501';
  end if;
  if not p_approve and nullif(btrim(p_note), '') is null then
    raise exception 'say why, so they can plan' using errcode = '22023';
  end if;

  -- What is left of this kind this year, before this request.
  if v_unpaid and v_r.kind in ('casual', 'sick', 'paid') then
    select a.days_per_year - coalesce((
             select sum(leave_days(lr.company_id,
                                   greatest(lr.start_date, date_trunc('year', v_r.start_date)::date),
                                   least(lr.end_date, (date_trunc('year', v_r.start_date) + interval '1 year - 1 day')::date),
                                   lr.half_day))
               from leave_requests lr
              where lr.company_id = v_r.company_id and lr.user_id = v_r.user_id and lr.kind = v_r.kind
                and lr.status = 'approved' and lr.id <> v_r.id
                and lr.start_date <= (date_trunc('year', v_r.start_date) + interval '1 year - 1 day')::date
                and lr.end_date >= date_trunc('year', v_r.start_date)::date), 0)
      into v_left
      from leave_allowances a
     where a.company_id = v_r.company_id and a.kind = v_r.kind;
    v_keep := greatest(floor(coalesce(v_left, 0)), 0)::int;
    if v_r.half_day then
      -- Half a day either fits in what is left or does not.
      if coalesce(v_left, 0) >= 0.5 then v_unpaid := false; end if;
    elsif v_keep > 0 then
      -- The last working day still covered; past it, the days are unpaid.
      select d into v_cut
        from (select d::date as d, row_number() over (order by d) as n
                from generate_series(v_r.start_date, v_r.end_date, interval '1 day') d
               where day_off(v_r.company_id, d::date) is null) w
       where n = v_keep;
      if v_cut is null or v_cut >= v_r.end_date then
        v_unpaid := false;   -- it all fits after all
      else
        v_split := true;
      end if;
    end if;
  end if;

  if v_split then
    insert into leave_requests (company_id, user_id, kind, start_date, end_date, half_day, reason,
                                status, decided_by, decided_at, decision_note)
      values (v_r.company_id, v_r.user_id, 'unpaid', v_cut + 1, v_r.end_date, false, v_r.reason,
              'approved', auth.uid(), now(), nullif(btrim(p_note), ''));
    update leave_requests
       set status = 'approved', end_date = v_cut,
           decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
     where id = p_id;
  else
    update leave_requests
       set status = case when p_approve then 'approved' else 'rejected' end,
           kind = case when v_unpaid then 'unpaid' else kind end,
           decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
     where id = p_id;
  end if;

  -- A day the sweep already marked absent is leave now, not an absence.
  if p_approve then
    delete from attendance
     where company_id = v_r.company_id and user_id = v_r.user_id
       and a_date between v_r.start_date and v_r.end_date
       and status = 'absent' and check_in_at is null;
  end if;

  perform create_notification(
    v_r.company_id, v_r.user_id, 'leave.decided',
    case when v_split then 'Leave approved · the extra days unpaid'
         when v_unpaid then 'Leave approved as unpaid'
         when p_approve then 'Leave approved' else 'Leave not approved' end,
    to_char(v_r.start_date, 'DD Mon') || case when v_r.end_date > v_r.start_date then ' – ' || to_char(v_r.end_date, 'DD Mon') else '' end
      || coalesce(' · ' || nullif(btrim(p_note), ''), ''),
    'leave_decided:' || p_id, 'leave', p_id,
    case when p_approve then 'info' else 'warning' end, '/leave');
end;
$$;
revoke all on function decide_leave(uuid, boolean, text, boolean) from public, anon;
grant execute on function decide_leave(uuid, boolean, text, boolean) to authenticated;
