-- Deliverables, round two: what the rebuild (0161) left behind.
--
--   * A dropped extra was still charged. recompute_project_additional summed
--     every chargeable client row whatever its status, so the client's
--     "we don't want the drone film any more" left it in total_cost, the
--     balance due and the quotation. Dropped rows now count for nothing,
--     on the totals and on both quotation readers.
--   * The editor's brief reached the client. The public quotation returned
--     each deliverable's description, which the project page now labels
--     "Brief -- songs, colour, anything the editor should know".
--   * Nobody told an editor anything. Being put on a deliverable now sends
--     them a notification, and the hourly job reminds them the day before
--     it is due, on the day, and once when it goes late.
--   * run_notification_generator('tasks') compared a task_status to 'done',
--     which is not one of its values, so it failed every time it ran.

-- ── totals: dropped rows are not owed ─────────────────────────────
create or replace function recompute_project_additional(p_project_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update projects p
    set additional_deliverables_cost = coalesce((
      select sum(d.additional_charge_amount)
      from deliverables d
      where d.project_id = p_project_id
        and d.visibility_scope = 'client'
        and d.show_on_quotation
        and d.is_additional_charge
        and d.status <> 'cancelled'
    ), 0)
  where p.id = p_project_id;
$$;

select recompute_project_additional(p.id)
  from projects p
 where exists (select 1 from deliverables d where d.project_id = p.id and d.status = 'cancelled');

-- ── issue_project_quotation — copied from 0042, dropped rows left out ──
create or replace function issue_project_quotation(
  p_project_id uuid,
  p_notes      text default null,
  p_ttl_hours  int  default 720
)
returns table (quotation_id uuid, token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company  uuid := get_current_company_id();
  v_project  projects;
  v_items    jsonb;
  v_quote    uuid;
  v_token    text;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_project from projects
   where id = p_project_id and company_id = v_company;
  if v_project.id is null then
    raise exception 'project not found' using errcode = 'P0001';
  end if;

  -- Only what the studio marked client-visible and quotable. The same rule the
  -- totals trigger uses, so the sum on the page matches the project.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'title', d.title,
               'chargeable', d.is_additional_charge,
               'amount', case when d.is_additional_charge
                              then d.additional_charge_amount else 0 end
             )
             order by d.is_additional_charge, d.title
           ),
           '[]'::jsonb
         )
    into v_items
    from deliverables d
   where d.project_id = p_project_id
     and d.company_id = v_company
     and d.visibility_scope = 'client'
     and d.show_on_quotation
     and d.status <> 'cancelled';

  insert into project_quotations (company_id, project_id, snapshot, notes, created_by)
  values (
    v_company, p_project_id,
    jsonb_build_object(
      'items', v_items,
      'package_cost', v_project.package_cost,
      'add_ons', v_project.additional_deliverables_cost,
      'total', v_project.total_cost,
      'project_name', v_project.name
    ),
    p_notes, auth.uid()
  )
  returning id into v_quote;

  v_token := issue_access_token('quotation', v_quote, p_ttl_hours);
  return query select v_quote, v_token;
end;
$$;

-- ── get_quotation_for_token — copied from 0146: no brief, no team work, no dropped rows ──
create or replace function get_quotation_for_token(p_raw text)
returns table (
  snapshot jsonb, notes text, accepted_at timestamptz, accepted_by_name text,
  declined_at timestamptz, client_name text, company_name text,
  logo_url text, company_phone text, company_email text, company_address text, gstin text,
  shoots_schedule jsonb, terms_text text, display_prefs jsonb,
  show_quotation boolean, expires_at timestamptz, revoked boolean, access_count int,
  -- document extras
  company_legal_name text, company_website text, document_footer_note text,
  client_phone text, client_email text, client_address text,
  project_name text, project_status text,
  quotation_number text, issued_at timestamptz, quotation_id uuid,
  deliverables jsonb, deliverables_2 jsonb,
  total_received numeric, balance_due numeric
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_quote uuid;
begin
  select at.subject_id into v_quote from access_tokens at
   where at.purpose = 'quotation'
     and at.token_hash = v_hash
     and (at.expires_at is null or at.expires_at > now())
     and at.revoked_at is null
   limit 1;
  if v_quote is null then
    return;
  end if;

  update access_tokens at set access_count = coalesce(at.access_count, 0) + 1
   where at.purpose = 'quotation' and at.token_hash = v_hash;
  update project_quotations q set access_count = coalesce(q.access_count, 0) + 1
   where q.id = v_quote;

  return query
  select q.snapshot, q.notes, q.accepted_at, q.accepted_by_name, q.declined_at,
         cl.name, coalesce(co.display_name, co.name),
         coalesce(co.invoice_logo_url, co.avatar_url),
         co.invoice_phone, co.invoice_email, co.invoice_address, co.invoice_gst_number,
         coalesce(q.shoots_schedule, '[]'::jsonb), q.terms_text,
         coalesce(q.display_prefs, '{}'::jsonb),
         coalesce(q.show_quotation, true), q.expires_at,
         (q.revoked_at is not null),
         coalesce(q.access_count, 0),
         co.legal_name, co.website, co.document_footer_note,
         cl.phone, cl.email, cl.address,
         p.name, p.status,
         -- Human-readable and stable: the studio's prefix plus the quote's own id.
         coalesce(co.quote_number_prefix, 'Q-') || upper(substring(q.id::text, 1, 8)),
         q.created_at, q.id,
         -- The real rows, so the document can show estimated dates and which
         -- items carry an extra charge rather than a flat "Included".
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', d.id, 'title', d.title,
                    'estimated_date', d.estimated_date,
                    'is_additional_charge', d.is_additional_charge,
                    'additional_charge_amount', coalesce(d.additional_charge_amount, 0))
                  order by d.created_at)
             from deliverables d
            where d.project_id = p.id and d.list_key = 'primary'
              and coalesce(d.show_on_quotation, true)
              and d.visibility_scope = 'client' and d.status <> 'cancelled'), '[]'::jsonb),
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'id', d.id, 'title', d.title,
                    'estimated_date', d.estimated_date,
                    'is_additional_charge', d.is_additional_charge,
                    'additional_charge_amount', coalesce(d.additional_charge_amount, 0))
                  order by d.created_at)
             from deliverables d
            where d.project_id = p.id and d.list_key <> 'primary'
              and coalesce(d.show_on_quotation, true)
              and d.visibility_scope = 'client' and d.status <> 'cancelled'), '[]'::jsonb),
         coalesce((select sum(x.amount) from received_payments x where x.project_id = p.id and x.status = 'paid'), 0),
         greatest(coalesce(p.total_cost, 0)
                  - coalesce((select sum(x.amount) from received_payments x where x.project_id = p.id and x.status = 'paid'), 0), 0)
    from project_quotations q
    join projects p on p.id = q.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = q.company_id
   where q.id = v_quote
     and q.revoked_at is null
     and (q.expires_at is null or q.expires_at > now());
end;
$$;

-- ── tell the editor ──────────────────────────────────────────────
-- On being put on a deliverable (not on putting yourself on one).
create or replace function deliverables_notify_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_project text;
begin
  if new.assignee_id is null
     or new.assignee_id = auth.uid()
     or (tg_op = 'UPDATE' and old.assignee_id is not distinct from new.assignee_id)
     or new.status in ('completed', 'cancelled') then
    return new;
  end if;
  select name into v_project from projects where id = new.project_id;
  perform create_notification(
    new.company_id, new.assignee_id, 'deliverable_assigned',
    'You are on ' || new.title,
    coalesce(v_project, '') || case when new.estimated_date is not null
      then ' · due ' || to_char(new.estimated_date, 'DD Mon') else '' end,
    'deliverable_assigned:' || new.id || ':' || new.assignee_id,
    'deliverable', new.id, 'info', '/my-work');
  return new;
end;
$$;

drop trigger if exists deliverables_notify_assignee on deliverables;
create trigger deliverables_notify_assignee
  after insert or update of assignee_id on deliverables
  for each row execute function deliverables_notify_assignee();

-- The day before, on the day, and once the day after it goes late. One
-- notification per deliverable per day, so the hourly tick never repeats one.
create or replace function run_deliverable_due_cron(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due     int := 0;
  v_created int := 0;
  v_r       record;
  v_summary jsonb;
  v_run     uuid;
  v_days    int;
begin
  insert into cron_runs (job_name, dry_run) values ('deliverable_due_cron', p_dry_run) returning id into v_run;

  for v_r in
    select d.id, d.company_id, d.title, d.assignee_id, d.estimated_date, p.name as project_name
      from deliverables d
      join projects p on p.id = d.project_id
     where d.assignee_id is not null
       and d.estimated_date is not null
       and d.status not in ('completed', 'cancelled')
       and p.status = 'active'
       and (d.estimated_date - current_date) in (1, 0, -1)
  loop
    v_due := v_due + 1;
    v_days := v_r.estimated_date - current_date;
    if not p_dry_run then
      if create_notification(
           v_r.company_id, v_r.assignee_id, 'deliverable_due',
           v_r.title || case v_days when 1 then ' is due tomorrow'
                                    when 0 then ' is due today'
                                    else ' is late' end,
           v_r.project_name,
           'deliverable_due:' || v_r.id || ':' || current_date,
           'deliverable', v_r.id,
           case when v_days < 0 then 'warning' else 'info' end,
           '/my-work') then
        v_created := v_created + 1;
      end if;
    end if;
  end loop;

  v_summary := jsonb_build_object('deliverables_due', v_due, 'notifications_created', v_created, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;

revoke all on function run_deliverable_due_cron(boolean) from public, anon;
grant execute on function run_deliverable_due_cron(boolean) to service_role;

-- ── run_notification_generator — copied from 0125, task status fixed ──
create or replace function run_notification_generator(
  p_key      text,
  p_dry_run  boolean default true,
  p_date_from timestamptz default null,
  p_date_to   timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_from timestamptz := coalesce(p_date_from, now() - interval '30 days');
  v_to   timestamptz := coalesce(p_date_to, now() + interval '30 days');
  v_scanned int := 0;
  v_generated int := 0;
  v_made boolean;
  r record;
begin
  if v_company is null then
    raise exception 'no company in context' using errcode = '42501';
  end if;

  if p_key = 'allocation_conflicts' then
    -- Two bookings for one person that overlap in time. `a.id < b.id` so each
    -- pair is reported once, not twice from both sides.
    for r in
      select a.user_id, a.id as slot_id, a.start_at, b.id as other_id
        from team_assignment_slots a
        join team_assignment_slots b
          on b.company_id = a.company_id and b.user_id = a.user_id and b.id > a.id
         and b.status = 'booked' and a.status = 'booked'
         and b.start_at < a.end_at and a.start_at < b.end_at
       where a.company_id = v_company and a.start_at between v_from and v_to
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'allocation.conflict',
          'Double booking', 'You are booked twice over the same hours.',
          'alloc_conflict:' || r.slot_id || ':' || r.other_id,
          'team_slot', r.slot_id, 'critical', '/team-allocation');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'reminders' then
    for r in
      select rm.id, rm.user_id, rm.title, rm.remind_at
        from reminders rm
       where rm.company_id = v_company and not rm.done
         and rm.remind_at between v_from and least(v_to, now())
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'reminder.due', 'Reminder due', r.title,
          'reminder_due:' || r.id, 'reminder', r.id, 'warning', '/reminders');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'tasks' then
    -- Overdue and unfinished, to whoever it is assigned to.
    for r in
      select t.id, t.title, t.due_date, ta.user_id
        from tasks t
        join task_assignees ta on ta.task_id = t.id
       where t.company_id = v_company
         and t.status not in ('completed', 'cancelled')
         and t.due_date is not null
         and t.due_date < current_date
         and t.due_date >= v_from::date
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'task.overdue', 'Task overdue', r.title,
          'task_overdue:' || r.id || ':' || r.due_date, 'task', r.id, 'warning', '/tasks');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'shoots' then
    -- Upcoming shoots, to the crew booked on them.
    for r in
      select s.id, s.name, s.shoot_date, tas.user_id
        from shoots s
        join team_assignment_slots tas on tas.shoot_id = s.id and tas.status = 'booked'
       where s.company_id = v_company
         and s.status in ('planned', 'confirmed')
         and s.shoot_date is not null
         and s.shoot_date between current_date and least(v_to, now() + interval '7 days')::date
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'shoot.upcoming', 'Shoot coming up',
          r.name || ' on ' || to_char(r.shoot_date, 'DD Mon'),
          'shoot_upcoming:' || r.id, 'shoot', r.id, 'info', '/shoots');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key in ('data_pending', 'backup_pending') then
    -- Same table, two independent custody tracks.
    for r in
      select d.id, d.data_label, u.user_id
        from shoot_data_records d
        cross join lateral notification_admin_recipients(v_company) u(user_id)
       where d.company_id = v_company
         and ((p_key = 'data_pending'   and d.primary_status = 'pending')
           or (p_key = 'backup_pending' and d.backup_status  = 'pending'))
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id,
          case when p_key = 'data_pending' then 'data.pending' else 'data.backup_pending' end,
          case when p_key = 'data_pending' then 'Data copy pending' else 'Backup pending' end,
          r.data_label, p_key || ':' || r.id, 'data_record', r.id, 'warning', '/data-management');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'payment_pending' then
    for r in
      select i.id, i.invoice_number, i.balance_due, i.due_date, u.user_id
        from invoices i
        cross join lateral notification_admin_recipients(v_company) u(user_id)
       where i.company_id = v_company
         and i.balance_due > 0
         and i.status <> 'cancelled'
         and i.due_date is not null
         and i.due_date < current_date
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'invoice.overdue', 'Payment overdue',
          'Invoice ' || coalesce(r.invoice_number, '') || ' — ' || to_char(r.balance_due, 'FM999999990.00') || ' outstanding',
          'invoice_overdue:' || r.id || ':' || r.due_date, 'invoice', r.id, 'critical', '/billing');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  elsif p_key = 'crm_follow_ups' then
    for r in
      select l.id, l.name, l.follow_up_at, l.assigned_to
        from crm_leads l
       where l.company_id = v_company
         and l.assigned_to is not null
         and l.status not in ('converted', 'lost')
         and l.follow_up_at is not null
         and l.follow_up_at < now()
         and l.follow_up_at >= v_from
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.assigned_to, 'crm.follow_up_overdue', 'Follow-up overdue',
          coalesce(r.name, 'A lead') || ' is past its follow-up time.',
          'lead_followup:' || r.id || ':' || date_trunc('day', r.follow_up_at),
          'crm_lead', r.id, 'warning', '/follow-ups');
        if v_made then v_generated := v_generated + 1; end if;
      end if;
    end loop;

  else
    raise exception 'unknown generator %', p_key using errcode = '22023';
  end if;

  return jsonb_build_object(
    'key', p_key,
    'dry_run', p_dry_run,
    'scanned', v_scanned,
    'generated', case when p_dry_run then 0 else v_generated end,
    'deduped', case when p_dry_run then 0 else v_scanned - v_generated end
  );
end;
$$;
