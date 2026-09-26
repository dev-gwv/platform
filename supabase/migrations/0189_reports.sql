-- 0189: Reports -- how the studio is doing for a period, on one screen.
--
-- Four reads, one per tab: sales, money, delivery, team. Each is one function
-- returning jsonb so the API makes one round trip per tab and the numbers can
-- be checked by hand in the pglite suite (supabase/tests/reports.test.ts).
--
-- Nothing here invents a new definition. Each number is the one another
-- screen already shows, read from the same table the same way:
--
--   enquiries, booked, lost   crm_leads (0168 folded `enquiries` into it; the
--                             web app no longer reads `enquiries`), not
--                             archived -- a merged lead is archived -- the
--                             same filter crm_stats (0137) uses.
--   booking value             projects created in the period, not cancelled,
--                             their total_cost (package + additional).
--   billed                    invoices issued in the period, not draft or
--                             cancelled -- the GST summary's filter.
--   received                  received_payments marked paid, by paid_on --
--                             the one ledger (0145), read as the P&L's cash
--                             income is (0167).
--   still to collect          project value not yet received -- the Billing
--                             overview and the P&L rail, same formula.
--   overdue                   invoices with money due past their due date --
--                             the Billing overview's overdue tile.
--   expenses                  expenses by date, at what they cost with tax
--                             (expense_cash_out, 0167).
--   delivered / on time       client deliverables marked completed
--                             (delivered_at is stamped then, 0161/0166)
--                             against their estimated_date, the date the
--                             due-date reminders use (0162).
--   shoots done               crew bookings on team_assignment_slots, the
--                             table payroll and the P&L read (shoot_assignments
--                             is no longer written by the app).
--   present / leave           attendance present-or-late, and approved leave
--                             on working days, the way payroll counts them
--                             (0187).
--
-- Dates are India dates: a timestamp is read in Asia/Kolkata before it is
-- compared with a period, so a lead at 1 am on the 1st is in that month.
--
-- SECURITY INVOKER: RLS scopes every table to the caller's studio, and each
-- query also names the studio it was asked about, so a mismatched id reads
-- nothing rather than something.

create or replace function report_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ── Sales ──────────────────────────────────────────────────────────────
create or replace function report_sales(p_company uuid, p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = public
as $$
  with leads as (
    select l.source::text as source, l.status::text as status
      from crm_leads l
     where l.company_id = p_company
       and l.is_archived = false
       and (l.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ), totals as (
    select count(*)::int as enquiries,
           count(*) filter (where status = 'converted')::int as booked
      from leads
  ), bookings as (
    select count(*)::int as n, coalesce(sum(p.total_cost), 0) as value
      from projects p
     where p.company_id = p_company
       and p.status <> 'cancelled'
       and (p.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ), lost as (
    select coalesce(nullif(trim(l.lost_reason), ''), 'No reason given') as reason
      from crm_leads l
     where l.company_id = p_company
       and l.is_archived = false
       and l.status = 'lost'
       and (l.stage_changed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'enquiries', t.enquiries,
    'booked', t.booked,
    'conversion_pct', case when t.enquiries > 0 then round(t.booked * 100.0 / t.enquiries, 1) end,
    'bookings', b.n,
    'booking_value', round(b.value, 2),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('source', s.source, 'enquiries', s.n, 'booked', s.booked)
                       order by s.n desc, s.booked desc, s.source)
        from (select source, count(*)::int as n, count(*) filter (where status = 'converted')::int as booked
                from leads group by source
               order by 2 desc, 3 desc, 1 limit 4) s), '[]'::jsonb),
    'lost', (select count(*)::int from lost),
    'lost_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('reason', r.reason, 'count', r.n) order by r.n desc, r.reason)
        from (select reason, count(*)::int as n from lost group by reason order by 2 desc, 1 limit 4) r), '[]'::jsonb)
  )
  from totals t cross join bookings b
$$;

-- ── Money ──────────────────────────────────────────────────────────────
create or replace function report_money(p_company uuid, p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = public
as $$
  with proj as (
    -- Each live project's value not yet received: the Billing overview's to_collect.
    select p.id, p.client_id, p.name,
           greatest(p.total_cost - coalesce((
             select sum(rp.amount) from received_payments rp
              where rp.project_id = p.id and coalesce(rp.status, 'paid') = 'paid'), 0), 0) as due
      from projects p
     where p.company_id = p_company and p.status <> 'cancelled'
  ), late as (
    select i.id, i.client_id, i.balance_due, i.due_date
      from invoices i
     where i.company_id = p_company
       and i.balance_due > 0 and i.status not in ('cancelled', 'draft')
       and i.due_date < report_today()
  ), owes as (
    select c.id as client_id, c.name as client_name, sum(pr.due) as outstanding,
           (select coalesce(sum(l.balance_due), 0) from late l where l.client_id = c.id) as overdue,
           (select report_today() - min(l.due_date) from late l where l.client_id = c.id) as overdue_days,
           (select l.id from late l where l.client_id = c.id order by l.due_date, l.id limit 1) as invoice_id,
           (select p2.id from proj p2 where p2.client_id = c.id order by p2.due desc, p2.id limit 1) as project_id
      from proj pr
      join clients c on c.id = pr.client_id
     where pr.due > 0
     group by c.id, c.name
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'billed', round(coalesce((
      select sum(i.total) from invoices i
       where i.company_id = p_company and i.status not in ('draft', 'cancelled')
         and i.invoice_date between p_from and p_to), 0), 2),
    'invoices', (select count(*)::int from invoices i
       where i.company_id = p_company and i.status not in ('draft', 'cancelled')
         and i.invoice_date between p_from and p_to),
    'received', round(coalesce((
      select sum(rp.amount) from received_payments rp
       where rp.company_id = p_company and coalesce(rp.status, 'paid') = 'paid'
         and rp.paid_on between p_from and p_to), 0), 2),
    'to_collect', round(coalesce((select sum(due) from proj), 0), 2),
    'overdue', round(coalesce((select sum(balance_due) from late), 0), 2),
    'overdue_invoices', (select count(*)::int from late),
    'expenses', round(coalesce((
      select sum(expense_cash_out(e)) from expenses e
       where e.company_id = p_company and e.expense_date between p_from and p_to), 0), 2),
    'owes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'client_id', o.client_id, 'client_name', o.client_name,
               'outstanding', round(o.outstanding, 2), 'overdue', round(o.overdue, 2),
               'overdue_days', o.overdue_days, 'invoice_id', o.invoice_id, 'project_id', o.project_id)
             order by o.outstanding desc, o.client_name)
        from (select * from owes order by outstanding desc, client_name limit 4) o), '[]'::jsonb)
  )
$$;

-- ── Delivery ───────────────────────────────────────────────────────────
create or replace function report_delivery(p_company uuid, p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = public
as $$
  with live as (
    select d.id, d.title, d.status, d.estimated_date, d.shoot_id, d.project_id, d.assignee_id,
           (d.delivered_at at time zone 'Asia/Kolkata')::date as delivered_on,
           p.name as project_name, p.client_id
      from deliverables d
      join projects p on p.id = d.project_id
     where d.company_id = p_company
       and d.visibility_scope = 'client'
       and d.status <> 'cancelled'
       and p.status <> 'cancelled'
  ), done as (
    select l.*,
           -- The deliverable's own shoot, else the project's last shoot before it went out.
           coalesce(
             (select s.shoot_date from shoots s where s.id = l.shoot_id),
             (select max(s.shoot_date) from shoots s
               where s.project_id = l.project_id and s.status <> 'cancelled' and s.shoot_date <= l.delivered_on)
           ) as shot_on
      from live l
     where l.status = 'completed' and l.delivered_on between p_from and p_to
  ), late as (
    select l.*, report_today() - l.estimated_date as days_late
      from live l
     where l.status <> 'completed' and l.estimated_date < report_today()
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'delivered', (select count(*)::int from done),
    'with_due_date', (select count(*)::int from done where estimated_date is not null),
    'on_time', (select count(*)::int from done where estimated_date is not null and delivered_on <= estimated_date),
    'on_time_pct', (select case when count(*) filter (where estimated_date is not null) > 0
                               then round(count(*) filter (where delivered_on <= estimated_date) * 100.0
                                          / count(*) filter (where estimated_date is not null), 1) end
                      from done),
    'avg_days_to_deliver', (select round(avg(delivered_on - shot_on), 1) from done where shot_on is not null and delivered_on >= shot_on),
    'late_now', (select count(*)::int from late),
    'late', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'title', x.title, 'project_id', x.project_id, 'project_name', x.project_name,
               'client_name', x.client_name, 'due_date', x.estimated_date, 'days_late', x.days_late,
               'assignee_name', x.assignee_name)
             order by x.days_late desc, x.title)
        from (select lt.*, c.name as client_name, u.name as assignee_name
                from late lt
                left join clients c on c.id = lt.client_id
                left join users u on u.user_id = lt.assignee_id
               order by lt.days_late desc, lt.title limit 5) x), '[]'::jsonb)
  )
$$;

-- ── Team ───────────────────────────────────────────────────────────────
create or replace function report_team(p_company uuid, p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = public
as $$
  with people as (
    select u.user_id, u.name
      from users u
     where u.company_id = p_company and u.deleted_at is null and coalesce(u.status, 'active') = 'active'
  ), shoots_done as (
    -- A shoot is done once its day has come; one per person per shoot.
    select t.user_id, count(distinct coalesce(t.shoot_id::text, t.id::text))::int as n
      from team_assignment_slots t
      left join shoots s on s.id = t.shoot_id
     where t.company_id = p_company
       and t.status not in ('cancelled', 'released')
       and coalesce(s.status, 'planned') <> 'cancelled'
       and coalesce(s.shoot_date, (t.start_at at time zone 'Asia/Kolkata')::date)
           between p_from and least(p_to, report_today())
     group by t.user_id
  ), delivered as (
    select d.assignee_id as user_id, count(*)::int as n
      from deliverables d
     where d.company_id = p_company and d.status = 'completed' and d.assignee_id is not null
       and (d.delivered_at at time zone 'Asia/Kolkata')::date between p_from and p_to
     group by d.assignee_id
  ), late as (
    select d.assignee_id as user_id, count(*)::int as n
      from deliverables d
      join projects p on p.id = d.project_id
     where d.company_id = p_company and d.assignee_id is not null
       and d.status not in ('completed', 'cancelled') and p.status <> 'cancelled'
       and d.estimated_date < report_today()
     group by d.assignee_id
  ), present as (
    select a.user_id, count(*)::int as n
      from attendance a
     where a.company_id = p_company and a.status in ('present', 'late')
       and a.a_date between p_from and p_to
     group by a.user_id
  ), leaves as (
    select lr.user_id, sum(case when lr.half_day then 0.5 else 1 end) as n
      from leave_requests lr
      join generate_series(p_from, p_to, interval '1 day') g(d)
        on g.d::date between lr.start_date and lr.end_date
     where lr.company_id = p_company and lr.status = 'approved'
       and lr.start_date <= p_to and lr.end_date >= p_from
       and day_off(p_company, g.d::date) is null
     group by lr.user_id
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'members', coalesce(jsonb_agg(jsonb_build_object(
        'user_id', pe.user_id, 'name', pe.name,
        'shoots', coalesce(sd.n, 0), 'delivered', coalesce(dl.n, 0), 'late_now', coalesce(lt.n, 0),
        'days_present', coalesce(pr.n, 0), 'leave_days', coalesce(lv.n, 0))
      order by coalesce(sd.n, 0) + coalesce(dl.n, 0) desc, pe.name), '[]'::jsonb)
  )
  from people pe
  left join shoots_done sd on sd.user_id = pe.user_id
  left join delivered dl on dl.user_id = pe.user_id
  left join late lt on lt.user_id = pe.user_id
  left join present pr on pr.user_id = pe.user_id
  left join leaves lv on lv.user_id = pe.user_id
$$;

revoke all on function report_today() from public, anon;
revoke all on function report_sales(uuid, date, date) from public, anon;
revoke all on function report_money(uuid, date, date) from public, anon;
revoke all on function report_delivery(uuid, date, date) from public, anon;
revoke all on function report_team(uuid, date, date) from public, anon;
grant execute on function report_today() to authenticated, service_role;
grant execute on function report_sales(uuid, date, date) to authenticated;
grant execute on function report_money(uuid, date, date) to authenticated;
grant execute on function report_delivery(uuid, date, date) to authenticated;
grant execute on function report_team(uuid, date, date) to authenticated;
