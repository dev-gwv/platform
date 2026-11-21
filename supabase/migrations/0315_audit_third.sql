-- 0315: audit, third batch (21 Nov). Claimed; body follows in the same pull request.
--
-- 1. project_outstanding(project): what a project still owes, one rule for
--    the database, the API and every screen (projectOutstanding in
--    packages/domain/src/outstanding.ts). The project's value is before GST
--    while money received includes the GST of the invoices it paid, so
--    "value - received" told a client ₹41,000 was left on a ₹1,00,000 project
--    whose ₹50,000 + 18% invoice was paid, when ₹50,000 was still to bill:
--
--      open invoice balances (GST included)
--    + the value no live invoice covers yet, less money in that sits on no invoice
--
--    With no invoices it is max(0, value - received); without GST it equals
--    the max(0, value - received, open invoice balances) Home and Payments
--    used since 6 Nov, and it is never below it. get_client_portal's
--    money.balance uses it (copied from 0252, only that line changed), and
--    receipt_balance_for_token() gives a receipt link its balance line.
--    project_financials has no balance column, so it is left alone.
--
-- 2. "Today" in India. 0314 added india_today(); the functions below still
--    read current_date (the server's UTC day, yesterday until 5:30 am IST).
--    Each is copied from the highest-numbered migration that defines it with
--    current_date -> india_today() and nothing else changed; the signature is
--    the same, so create or replace keeps its grants. A test fails on any
--    live function that still reads current_date.
--
-- 3. A plan given "after the current plan" waits for it. 0306's
--    platform_assign_plan set companies.plan at once and only moved the
--    expiry, so a Studio Max studio given Starter "after the current plan"
--    fell to Starter's limits that minute. Now a different plan given for
--    later is kept in companies.plan_next / plan_next_from and
--    apply_pending_plans() (the five-minute messages tick) switches it when
--    the current plan ends; the plan year starts again then. Start today, or
--    the same plan, clears anything pending.
--
-- Safe to run twice.

-- ── 1. project_outstanding ───────────────────────────────────────────
create or replace function project_outstanding(p_project uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  with inv as (
    select coalesce(sum(i.total), 0) as total,
           coalesce(sum(i.tax), 0) as tax,
           coalesce(sum(greatest(i.balance_due, 0)), 0) as open
      from invoices i
     where i.project_id = p_project and i.status not in ('draft', 'cancelled')
  ), rec as (
    select coalesce(sum(rp.amount), 0) as received
      from received_payments rp
     where rp.project_id = p_project and rp.status = 'paid'
  )
  select round(greatest(0,
           inv.open
           + greatest(0, coalesce(p.total_cost, 0) - (inv.total - inv.tax)
                         - greatest(0, rec.received - (inv.total - inv.open)))), 2)
    from projects p, inv, rec
   where p.id = p_project
$$;
revoke all on function project_outstanding(uuid) from public, anon;
grant execute on function project_outstanding(uuid) to authenticated, service_role;

-- A receipt's "Balance" line: the same rule for the payment's project, read by
-- the receipt link's token (as get_receipt_for_token reads it, without
-- counting a visit). Null for a wrong, stopped or expired token.
create or replace function receipt_balance_for_token(p_raw text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select project_outstanding(rp.project_id)
    from access_tokens at
    join received_payments rp on rp.id = at.subject_id
   where at.purpose = 'receipt'
     and at.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
     and (at.expires_at is null or at.expires_at > now())
     and at.revoked_at is null
     and rp.project_id is not null
   limit 1
$$;
revoke all on function receipt_balance_for_token(text) from public, anon, authenticated;
grant execute on function receipt_balance_for_token(text) to service_role;

-- get_client_portal: copied from 0252_client_tracking.sql; only money.balance changed.
create or replace function get_client_portal(p_raw text, p_count boolean default true)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_link client_portal_links;
  v_out jsonb;
  v_received numeric;
begin
  v_link := client_portal_link_for_token(p_raw);
  if v_link.id is null then
    return null;
  end if;

  select coalesce(sum(rp.amount), 0) into v_received
    from received_payments rp
   where rp.project_id = v_link.project_id and rp.company_id = v_link.company_id
     and coalesce(rp.status, 'paid') = 'paid';

  select jsonb_build_object(
    'studio', jsonb_build_object(
      'name', coalesce(co.display_name, co.name),
      'logo_url', coalesce(th.logo_url, co.invoice_logo_url, co.avatar_url),
      'phone', co.invoice_phone,
      'email', co.invoice_email,
      'website', co.website,
      'city', co.city,
      'brand_color', case when th.is_custom_theme then coalesce(th.primary_color, th.custom_color) end,
      'theme_preset', th.preset_key
    ),
    'project', jsonb_build_object(
      'name', p.name,
      'client_name', cl.name,
      'status', p.status
    ),
    'options', jsonb_build_object(
      'show_payments', v_link.show_payments,
      'allow_feedback', v_link.allow_feedback,
      'expires_at', v_link.expires_at
    ),
    'shoots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'shoot_date', s.shoot_date,
               'start_at', s.start_at, 'end_at', s.end_at, 'guests', s.guests,
               'location', s.location, 'map_link', s.map_link,
               'status', s.status,
               'team', case when v_link.show_team then coalesce((
                 select jsonb_agg(jsonb_build_object('first_name', t.first_name, 'role', t.role)
                                  order by t.role nulls last, t.first_name)
                   from (
                     select distinct split_part(trim(u.name), ' ', 1) as first_name,
                            nullif(trim(x.service_name), '') as role
                       from (
                         select ts.user_id, ts.service_name from team_assignment_slots ts
                          where ts.shoot_id = s.id and ts.company_id = s.company_id and ts.status = 'booked'
                         union
                         select sa.user_id, sa.service_name from shoot_assignments sa
                          where sa.shoot_id = s.id and sa.company_id = s.company_id and sa.status <> 'declined'
                       ) x
                       join users u on u.user_id = x.user_id and u.company_id = s.company_id
                      where u.deleted_at is null
                   ) t), '[]'::jsonb) else '[]'::jsonb end
             ) order by s.shoot_date nulls last, s.start_at nulls last, s.created_at)
        from shoots s
       where s.project_id = p.id and s.company_id = p.company_id and s.status <> 'cancelled'), '[]'::jsonb),
    'deliverables', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', d.title, 'description', d.description,
               'status', client_portal_status(d.status, d.custom_status_code),
               'expected_date', d.estimated_date,
               'delivered_at', d.delivered_at,
               'delivery_link', case when client_portal_status(d.status, d.custom_status_code) in ('ready', 'delivered')
                                   then nullif(trim(d.delivery_link), '') end,
               'shoot_name', (select s.name from shoots s where s.id = d.shoot_id and s.company_id = d.company_id),
               'feedback', (
                 select jsonb_build_object('kind', f.kind, 'message', f.message, 'created_at', f.created_at)
                   from client_portal_feedback f
                  where f.deliverable_id = d.id and f.company_id = d.company_id
                  order by f.created_at desc limit 1)
             ) order by d.estimated_date nulls last, d.created_at)
        from deliverables d
       where d.project_id = p.id and d.company_id = p.company_id
         and d.visibility_scope = 'client'
         and coalesce(d.show_on_quotation, true)
         and d.status <> 'cancelled'), '[]'::jsonb),
    'money', case when v_link.show_payments then jsonb_build_object(
      'total', coalesce(p.total_cost, 0),
      'received', v_received,
      -- 0315: the one rule (project_outstanding), GST paid on invoices not counted against the value.
      'balance', project_outstanding(p.id),
      -- The next payment: the earliest sent invoice with money still due.
      'next_due', (
        select jsonb_build_object('amount', i.balance_due, 'due_date', i.due_date)
          from invoices i
         where i.project_id = p.id and i.company_id = p.company_id
           and i.status not in ('draft', 'cancelled') and coalesce(i.balance_due, 0) > 0
         order by i.due_date nulls last, i.invoice_date
         limit 1),
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', i.id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date,
                 'due_date', i.due_date, 'status', i.status, 'total', i.total,
                 'balance_due', i.balance_due) order by i.invoice_date, i.created_at)
          from invoices i
         where i.project_id = p.id and i.company_id = p.company_id
           and i.status not in ('draft', 'cancelled')), '[]'::jsonb)
    ) end,
    -- The tracker's first step: the quotation accepted, the terms agreed.
    'booked', jsonb_build_object(
      'quotation_accepted_at', (select max(q.accepted_at) from project_quotations q
                                 where q.project_id = p.id and q.company_id = p.company_id),
      'terms_agreed_at', (select max(t.acknowledged_at) from project_terms_documents t
                           where t.project_id = p.id and t.company_id = p.company_id and t.revoked_at is null)
    ),
    -- Footage safe: of the days shot, how many have every card copied and
    -- backed up. "tracks" is false for a studio that does not record data,
    -- and the step is hidden then.
    'footage', jsonb_build_object(
      'tracks', exists (select 1 from shoot_data_records r where r.company_id = p.company_id),
      'shot', (select count(*) from shoots s
                where s.project_id = p.id and s.company_id = p.company_id and s.status <> 'cancelled'
                  and s.shoot_date is not null and s.shoot_date <= (now() at time zone 'Asia/Kolkata')::date),
      'safe', (select count(*) from shoots s
                where s.project_id = p.id and s.company_id = p.company_id and s.status <> 'cancelled'
                  and s.shoot_date is not null and s.shoot_date <= (now() at time zone 'Asia/Kolkata')::date
                  and exists (select 1 from shoot_data_records r where r.shoot_id = s.id
                               and r.data_status <> 'not_required')
                  and not exists (select 1 from shoot_data_records r where r.shoot_id = s.id
                                   and r.data_status not in ('backed_up', 'verified', 'archived', 'not_required')))
    ),
    -- The last five things that happened, newest first, in the client's words.
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('at', u.happened_at, 'text', u.what) order by u.happened_at desc)
        from (
          select * from (
            select s.shoot_date::timestamptz as happened_at, s.name || ' shot' as what
              from shoots s
             where s.project_id = p.id and s.company_id = p.company_id and s.status <> 'cancelled'
               and s.shoot_date is not null and s.shoot_date < (now() at time zone 'Asia/Kolkata')::date
            union all
            select d.delivered_at, d.title || ' delivered'
              from deliverables d
             where d.project_id = p.id and d.company_id = p.company_id and d.delivered_at is not null
               and d.visibility_scope = 'client' and coalesce(d.show_on_quotation, true) and d.status <> 'cancelled'
            union all
            select n.created_at, d.title || ' is ready to view'
              from deliverable_notes n
              join deliverables d on d.id = n.deliverable_id
             where d.project_id = p.id and d.company_id = p.company_id and n.kind = 'event'
               and n.body like 'moved:review:with_client%'
               and d.visibility_scope = 'client' and coalesce(d.show_on_quotation, true) and d.status <> 'cancelled'
            union all
            select t.acknowledged_at, 'Terms agreed'
              from project_terms_documents t
             where t.project_id = p.id and t.company_id = p.company_id and t.acknowledged_at is not null
               and t.revoked_at is null
            union all
            select rp.paid_on::timestamptz, 'Payment received'
              from received_payments rp
             where v_link.show_payments and rp.project_id = p.id and rp.company_id = p.company_id
               and coalesce(rp.status, 'paid') = 'paid' and rp.paid_on is not null
          ) x
          where x.happened_at is not null
          order by x.happened_at desc
          limit 5
        ) u), '[]'::jsonb),
    'terms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'title', coalesce(d.title, 'Terms & agreement'),
               'sent_at', coalesce(d.sent_at, d.created_at),
               'agreed_at', d.acknowledged_at, 'agreed_by', d.acknowledged_by_name)
             order by coalesce(d.sent_at, d.created_at) desc)
        from project_terms_documents d
       where d.project_id = p.id and d.company_id = p.company_id
         and d.revoked_at is null and not d.is_draft
         and (d.sent_at is not null or d.acknowledged_at is not null)), '[]'::jsonb)
  ) into v_out
    from projects p
    join companies co on co.id = p.company_id
    left join company_theme_settings th on th.company_id = p.company_id
    left join clients cl on cl.id = p.client_id and cl.company_id = p.company_id
   where p.id = v_link.project_id and p.company_id = v_link.company_id;

  if v_out is not null and coalesce(p_count, true) then
    update client_portal_links
       set view_count = view_count + 1, last_viewed_at = now()
     where id = v_link.id;
  end if;
  return v_out;
end;
$$;

-- ── 2. today is India's today ────────────────────────────────────────
-- accept_quote: copied from 0151_unassigned_leads_still_alert.sql; current_date -> india_today() (1), nothing else changed.
create or replace function accept_quote(p_raw text, p_name text, p_email text default null, p_ip text default null, p_user_agent text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_q crm_quotes;
  v_to uuid;
begin
  select id into v_id from crm_quotes q
   where q.status = 'sent'
     and exists (select 1 from access_tokens t where t.purpose = 'quote_accept' and t.subject_id = q.id
                   and t.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
                   and t.used_at is null and (t.expires_at is null or t.expires_at > now()));
  if v_id is null then return false; end if;
  select * into v_q from crm_quotes where id = v_id;
  if v_q.valid_until is not null and v_q.valid_until < india_today() then
    update crm_quotes set status = 'expired' where id = v_id;
    return false;
  end if;
  perform consume_access_token('quote_accept', p_raw);
  update crm_quotes
     set status = 'accepted', accepted_at = now(), accepted_by_name = p_name, accepted_by_email = p_email,
         accepted_ip = p_ip, accepted_user_agent = p_user_agent
   where id = v_id;
  update crm_leads set deal_value = v_q.total where id = v_q.lead_id;
  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_q.company_id, v_q.lead_id, null, null, null, 'quote ' || v_q.quote_number || ' accepted by ' || coalesce(p_name, 'client'));
  insert into crm_activities (company_id, lead_id, type, direction, subject, actor_id)
  values (v_q.company_id, v_q.lead_id, 'note', 'in', 'Accepted quote ' || v_q.quote_number, null);

  -- Somebody hears about this even when the lead is unassigned: it is a
  -- booking, and it is the event the studio least wants to miss.
  v_to := crm_alert_recipient(v_q.company_id,
                              (select assigned_to from crm_leads where id = v_q.lead_id));
  if v_to is not null then
    perform create_notification(
      v_q.company_id, v_to, 'crm_quote',
      'Quote accepted: ' || v_q.quote_number, coalesce(p_name, 'The client') || ' accepted the quote.',
      'crm_quote_accepted:' || v_q.id::text, 'crm_lead', v_q.lead_id);
  end if;
  return true;
end;
$$;

-- create_invoice: copied from 0284_edit_and_undo.sql; current_date -> india_today() (1), nothing else changed.
create or replace function create_invoice(
  p_client_id       uuid,
  p_project_id      uuid,
  p_place_of_supply text,
  p_invoice_date    date,
  p_due_date        date,
  p_subtotal        numeric,
  p_discount        numeric,
  p_taxable         numeric,
  p_tax             numeric,
  p_total           numeric,
  p_items           jsonb,
  p_notes           text default null,
  p_template_id     uuid default null,
  p_invoice_number  text default null,
  p_discount_type   text default 'flat',
  p_bank_details    text default null,
  p_terms           text default null
)
returns table (id uuid, invoice_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_number  text;
  v_id      uuid;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_template_id is not null and not exists (
    select 1 from invoice_templates where invoice_templates.id = p_template_id and company_id = v_company
  ) then
    raise exception 'template not in this studio' using errcode = '42501';
  end if;

  v_number := nullif(trim(p_invoice_number), '');
  if v_number is null then
    -- Running, by the invoice's date, or refused when the studio types them (0284).
    v_number := next_invoice_number_on(coalesce(p_invoice_date, (now() at time zone 'Asia/Kolkata')::date));
  end if;

  insert into invoices (company_id, client_id, project_id, invoice_number, invoice_date,
    due_date, place_of_supply, status, subtotal, discount, discount_type, taxable, tax, total, balance_due,
    notes, bank_details, terms, template_id, created_by)
    values (v_company, p_client_id, p_project_id, v_number, coalesce(p_invoice_date, india_today()),
      p_due_date, p_place_of_supply, 'sent', p_subtotal, p_discount,
      coalesce(nullif(trim(p_discount_type), ''), 'flat'),
      p_taxable, p_tax, p_total,
      p_total, p_notes, nullif(trim(p_bank_details), ''), nullif(trim(p_terms), ''), p_template_id, auth.uid())
    returning invoices.id into v_id;

  insert into invoice_items (invoice_id, company_id, description, subtext, quantity, rate, amount,
    gst_rate, taxable, cgst, sgst, igst, sort_order)
  select v_id, v_company, e ->> 'description', nullif(e ->> 'subtext', ''),
    (e ->> 'quantity')::numeric, (e ->> 'rate')::numeric, (e ->> 'amount')::numeric,
    (e ->> 'gst_rate')::numeric, (e ->> 'taxable')::numeric,
    (e ->> 'cgst')::numeric, (e ->> 'sgst')::numeric, (e ->> 'igst')::numeric,
    (ord - 1)::int
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(e, ord);

  return query select v_id, v_number;
end;
$$;

-- create_project_with_details: copied from 0164_projects_section.sql; current_date -> india_today() (1), nothing else changed.
CREATE OR REPLACE FUNCTION public.create_project_with_details(p_client_id uuid, p_name text, p_package_cost numeric DEFAULT 0, p_status text DEFAULT 'active'::text, p_show_quotation boolean DEFAULT false, p_deliverables jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_company uuid := get_current_company_id();
  v_project uuid;
begin
  if v_company is null then
    raise exception 'no tenant context' using errcode = '42501';
  end if;
  if not exists (select 1 from clients where id = p_client_id and company_id = v_company) then
    raise exception 'client not in this studio' using errcode = '42501';
  end if;

  insert into projects (company_id, client_id, name, package_cost, status, show_quotation, created_by)
    values (v_company, p_client_id, p_name, coalesce(p_package_cost, 0), coalesce(p_status, 'active'),
            coalesce(p_show_quotation, false), auth.uid())
    returning id into v_project;

  insert into deliverables (
    company_id, project_id, list_key, title, description,
    is_additional_charge, additional_charge_amount, visibility_scope,
    show_on_quotation, estimated_date, start_rule, delivery_days_after_start,
    work_type, internal_notes
  )
  select
    v_company, v_project,
    coalesce(e ->> 'list_key', 'primary'),
    e ->> 'title',
    e ->> 'description',
    coalesce((e ->> 'is_additional_charge')::boolean, false),
    coalesce((e ->> 'additional_charge_amount')::numeric, 0),
    coalesce(e ->> 'visibility_scope', 'client'),
    coalesce((e ->> 'show_on_quotation')::boolean, true),
    nullif(e ->> 'estimated_date', '')::date,
    coalesce(e ->> 'start_rule', 'whole_project'),
    nullif(e ->> 'delivery_days_after_start', '')::int,
    e ->> 'work_type',
    e ->> 'internal_notes'
  from jsonb_array_elements(coalesce(p_deliverables, '[]'::jsonb)) as e
  where (e ->> 'title') is not null;

  insert into received_payments (
    company_id, project_id, client_id, amount, paid_on, mode, reference, notes,
    status, description, is_gst, gst_number, recorded_by
  )
  select
    v_company, v_project, p_client_id,
    (e ->> 'amount')::numeric,
    coalesce(nullif(e ->> 'paid_on', '')::date, india_today()),
    e ->> 'mode', e ->> 'reference', e ->> 'notes',
    -- A promised advance stays promised: only 'pending' is kept, anything
    -- else (including nothing) means the money came in.
    case when e ->> 'status' = 'pending' then 'pending' else 'paid' end,
    nullif(e ->> 'description', ''),
    coalesce((e ->> 'is_gst')::boolean, false),
    nullif(e ->> 'gst_number', ''),
    auth.uid()
  from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) as e
  where (e ->> 'amount') is not null and (e ->> 'amount')::numeric > 0;

  return v_project;
end;
$$;

-- crm_apply_automations: copied from 0036_crm_v4.sql; current_date -> india_today() (1), nothing else changed.
create or replace function crm_apply_automations(p_lead_id uuid, p_trigger text, p_from_status text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead crm_leads;
  v_rule crm_automation_rules;
  v_applied int := 0;
  v_title text;
  v_cadence uuid;
  v_step crm_cadence_steps;
  v_next timestamptz;
begin
  select * into v_lead from crm_leads where id = p_lead_id;
  if not found then return 0; end if;

  for v_rule in
    select * from crm_automation_rules
    where company_id = v_lead.company_id and is_active and trigger = p_trigger
    order by created_at
  loop
    if not crm_rule_matches(v_rule.condition, v_lead, p_from_status) then continue; end if;

    if p_trigger = 'follow_up_overdue' then
      insert into crm_automation_runs (rule_id, lead_id) values (v_rule.id, v_lead.id)
      on conflict do nothing;
      if not found then continue; end if;
    end if;

    if v_rule.action = 'assign_to' then
      update crm_leads set assigned_to = nullif(v_rule.action_value->>'user_id', '')::uuid where id = v_lead.id;
    elsif v_rule.action = 'set_follow_up_days' then
      update crm_leads
         set follow_up_at = date_trunc('day', now()) + make_interval(days => coalesce((v_rule.action_value->>'days')::int, 1)) + interval '10 hours'
       where id = v_lead.id;
    elsif v_rule.action = 'mark_hot' then
      update crm_leads set is_hot = true where id = v_lead.id;
    elsif v_rule.action = 'add_note' then
      update crm_leads
         set notes = nullif(trim(coalesce(notes, '') || chr(10) || coalesce(v_rule.action_value->>'note', '')), '')
       where id = v_lead.id;
    elsif v_rule.action = 'notify_assignee' then
      if v_lead.assigned_to is not null then
        v_title := case p_trigger
          when 'lead_created' then 'New lead: ' || coalesce(v_lead.name, v_lead.phone, 'unnamed')
          when 'stage_changed' then coalesce(v_lead.name, v_lead.phone, 'A lead') || ' moved to ' || v_lead.status
          else 'Follow-up overdue: ' || coalesce(v_lead.name, v_lead.phone, 'unnamed') end;
        perform create_notification(
          v_lead.company_id, v_lead.assigned_to, 'crm', v_title,
          coalesce(v_rule.action_value->>'note', null),
          'crm_auto:' || v_rule.id::text || ':' || v_lead.id::text || ':' || p_trigger || ':' || india_today()::text,
          'crm_lead', v_lead.id);
      end if;
    elsif v_rule.action = 'start_cadence' then
      -- Same as start_lead_cadence, without the caller checks: this runs from
      -- a trigger or the cron, as the definer.
      v_cadence := nullif(v_rule.action_value->>'cadence_id', '')::uuid;
      select * into v_step from crm_cadence_steps s
        join crm_cadences c on c.id = s.cadence_id
       where s.cadence_id = v_cadence and c.company_id = v_lead.company_id and c.is_active
       order by s.step_no limit 1;
      if found then
        v_next := greatest(crm_cadence_step_time(now(), v_step.day_offset), now() + interval '5 minutes');
        insert into crm_lead_cadences (lead_id, company_id, cadence_id, step_no, next_at)
        values (v_lead.id, v_lead.company_id, v_cadence, v_step.step_no, v_next)
        on conflict (lead_id) do nothing;
        if found then
          update crm_leads set follow_up_at = v_next where id = v_lead.id;
        end if;
      end if;
    end if;

    insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
    values (v_lead.company_id, v_lead.id, null, null, null, 'automation: ' || v_rule.name);
    v_applied := v_applied + 1;
  end loop;
  return v_applied;
end;
$$;

-- crm_enroll_workflows: copied from 0047_crm_workflows.sql; current_date -> india_today() (1), nothing else changed.
create or replace function crm_enroll_workflows(p_lead uuid, p_trigger text, p_from_status text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead crm_leads;
  v_wf crm_workflows;
  v_id uuid;
  v_n int := 0;
  v_company uuid := get_current_company_id();
begin
  select * into v_lead from crm_leads where id = p_lead;
  if not found then return 0; end if;
  if v_company is not null and v_company is distinct from v_lead.company_id then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  for v_wf in
    select * from crm_workflows
    where company_id = v_lead.company_id and is_active and trigger = p_trigger
    order by created_at
  loop
    if not crm_cond_matches(v_wf.condition, v_lead, p_from_status) then continue; end if;
    if exists (select 1 from crm_workflow_enrollments e where e.workflow_id = v_wf.id and e.lead_id = v_lead.id and e.status = 'active') then continue; end if;
    if p_trigger = 'follow_up_overdue' then
      -- The hourly sweep asks again every hour; once a day is enough.
      if exists (select 1 from crm_workflow_enrollments e where e.workflow_id = v_wf.id and e.lead_id = v_lead.id and e.enrolled_at::date = india_today()) then continue; end if;
    elsif not v_wf.allow_reenroll and exists (select 1 from crm_workflow_enrollments e where e.workflow_id = v_wf.id and e.lead_id = v_lead.id) then
      continue;
    end if;
    insert into crm_workflow_enrollments (workflow_id, lead_id, company_id, next_at)
    values (v_wf.id, v_lead.id, v_lead.company_id, now())
    returning id into v_id;
    perform crm_run_enrollment(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- crm_expire_quotes: copied from 0150_expire_quotes.sql; current_date -> india_today() (2), nothing else changed.
create or replace function crm_expire_quotes(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due int := 0;
  v_expired int := 0;
  v_r record;
begin
  select count(*) into v_due
    from crm_quotes
   where status = 'sent' and valid_until is not null and valid_until < india_today();

  if p_dry_run then
    return jsonb_build_object('due', v_due, 'expired', 0, 'dry_run', true);
  end if;

  for v_r in
    select id, company_id, lead_id, quote_number, valid_until
      from crm_quotes
     where status = 'sent' and valid_until is not null and valid_until < india_today()
  loop
    update crm_quotes set status = 'expired' where id = v_r.id;
    v_expired := v_expired + 1;
    -- On the lead's own timeline, because "we quoted and heard nothing" is a
    -- fact about the deal, not about the quote row.
    if v_r.lead_id is not null then
      insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
      values (v_r.company_id, v_r.lead_id, null, null, null,
              'quote ' || v_r.quote_number || ' expired (valid till ' || to_char(v_r.valid_until, 'DD Mon YYYY') || ')');
    end if;
  end loop;

  return jsonb_build_object('due', v_due, 'expired', v_expired, 'dry_run', false);
end;
$$;

-- crm_sla_sweep: copied from 0045_crm_objects.sql; current_date -> india_today() (1), nothing else changed.
create or replace function crm_sla_sweep(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_breached int := 0;
  v_notified int := 0;
  v_to uuid;
begin
  for v_r in
    select l.id, l.company_id, l.assigned_to, l.name, l.phone, l.sla_due_at, c.owner_user_id
    from crm_leads l
    join companies c on c.id = l.company_id
    where l.is_archived = false
      and l.status not in ('converted', 'lost')
      and l.last_contacted_at is null
      and l.sla_due_at is not null
      and l.sla_due_at < now()
  loop
    v_breached := v_breached + 1;
    if p_dry_run then continue; end if;
    v_to := coalesce(v_r.assigned_to, v_r.owner_user_id);
    if create_notification(
         v_r.company_id, v_to, 'crm_sla',
         'SLA breached: ' || coalesce(v_r.name, v_r.phone, 'unnamed lead'),
         'Nobody has reached them since ' || to_char(v_r.sla_due_at, 'DD Mon HH24:MI'),
         'crm_sla:' || v_r.id::text || ':' || india_today()::text,
         'crm_lead', v_r.id)
    then
      v_notified := v_notified + 1;
    end if;
    if not exists (select 1 from crm_lead_events e where e.lead_id = v_r.id and e.note = 'SLA breached') then
      insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
      values (v_r.company_id, v_r.id, null, null, null, 'SLA breached');
    end if;
  end loop;
  return jsonb_build_object('breached', v_breached, 'notified', v_notified);
end;
$$;

-- crm_task_reminders: copied from 0209_crm_open_fields.sql; current_date -> india_today() (1), nothing else changed.
create or replace function crm_task_reminders(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r record;
  v_due int := 0;
  v_notified int := 0;
  v_to uuid;
begin
  for v_r in
    select a.id, a.company_id, a.subject, a.due_at, coalesce(a.assigned_to, l.assigned_to) as who,
           l.name as lead_name, l.phone, a.lead_id
    from crm_activities a
    left join crm_leads l on l.id = a.lead_id
    where a.type = 'task' and a.done_at is null and a.due_at is not null and a.due_at <= now()
      and coalesce(a.meta->>'auto', '') <> 'true'
  loop
    v_due := v_due + 1;
    if p_dry_run then continue; end if;
    v_to := crm_alert_recipient(v_r.company_id, v_r.who);
    if v_to is null then continue; end if;
    if create_notification(
         v_r.company_id, v_to, 'crm_task',
         'Task due: ' || coalesce(v_r.subject, 'follow up'),
         case when v_r.lead_name is not null or v_r.phone is not null then 'For ' || coalesce(v_r.lead_name, v_r.phone) else null end,
         'crm_task:' || v_r.id::text || ':' || india_today()::text,
         'crm_lead', v_r.lead_id)
    then
      v_notified := v_notified + 1;
    end if;
  end loop;
  return jsonb_build_object('due', v_due, 'notified', v_notified);
end;
$$;

-- duplicate_quote: copied from 0286_edit_and_undo_crm_team.sql; current_date -> india_today() (1), nothing else changed.
create or replace function duplicate_quote(p_quote uuid)
returns table (id uuid, quote_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_q       crm_quotes;
  v_number  text;
  v_id      uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_q from crm_quotes q where q.id = p_quote and q.company_id = v_company;
  if not found then
    raise exception 'unknown quote' using errcode = '42501';
  end if;
  v_number := next_quote_number();
  insert into crm_quotes (company_id, lead_id, contact_id, quote_number, title, valid_until, place_of_supply, intra_state,
                          subtotal, discount, taxable, tax, total, notes, terms, created_by)
  values (v_company, v_q.lead_id, v_q.contact_id, v_number, v_q.title,
          -- A date already gone would make the new draft expired on arrival.
          case when v_q.valid_until >= india_today() then v_q.valid_until end,
          v_q.place_of_supply, v_q.intra_state,
          v_q.subtotal, v_q.discount, v_q.taxable, v_q.tax, v_q.total, v_q.notes, v_q.terms, auth.uid())
  returning crm_quotes.id into v_id;

  insert into crm_quote_items (quote_id, company_id, description, quantity, rate, amount, gst_rate, taxable,
                               cgst, sgst, igst, sort_order, unit, days)
  select v_id, v_company, i.description, i.quantity, i.rate, i.amount, i.gst_rate, i.taxable,
         i.cgst, i.sgst, i.igst, i.sort_order, i.unit, i.days
    from crm_quote_items i
   where i.quote_id = p_quote;

  insert into crm_lead_events (company_id, lead_id, from_status, to_status, actor_id, note)
  values (v_company, v_q.lead_id, null, null, auth.uid(),
          'quote ' || v_q.quote_number || ' revised as ' || v_number);
  return query select v_id, v_number;
end;
$$;

-- get_quote_for_token: copied from 0266_line_unit_days_again.sql; current_date -> india_today() (1), nothing else changed.
create or replace function get_quote_for_token(p_raw text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid := resolve_access_token('quote_accept', p_raw);
  v_q crm_quotes;
  r jsonb;
begin
  if v_id is null then
    -- A consumed token still shows the quote, read-only, so the client can
    -- come back to what they agreed to.
    select id into v_id from crm_quotes q
     where exists (select 1 from access_tokens t where t.purpose = 'quote_accept' and t.subject_id = q.id
                     and t.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex'));
    if v_id is null then return null; end if;
  end if;
  select * into v_q from crm_quotes where id = v_id;
  select jsonb_build_object(
    'quote_number', v_q.quote_number, 'title', v_q.title, 'status', v_q.status, 'valid_until', v_q.valid_until,
    'subtotal', v_q.subtotal, 'discount', v_q.discount, 'taxable', v_q.taxable, 'tax', v_q.tax, 'total', v_q.total,
    'notes', v_q.notes, 'terms', v_q.terms, 'accepted_at', v_q.accepted_at, 'declined_at', v_q.declined_at,
    'place_of_supply', v_q.place_of_supply, 'intra_state', v_q.intra_state,
    'studio', (select c.name from companies c where c.id = v_q.company_id),
    'client_name', (select coalesce(l.name, ct.name) from crm_leads l left join crm_contacts ct on ct.id = l.contact_id where l.id = v_q.lead_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'description', i.description, 'quantity', i.quantity, 'rate', i.rate, 'amount', i.amount,
                'gst_rate', i.gst_rate, 'taxable', i.taxable, 'cgst', i.cgst, 'sgst', i.sgst, 'igst', i.igst, 'unit', i.unit, 'days', i.days) order by i.sort_order), '[]'::jsonb)
              from crm_quote_items i where i.quote_id = v_q.id),
    'expired', v_q.valid_until is not null and v_q.valid_until < india_today() and v_q.status = 'sent'
  ) into r;
  return r;
end;
$$;

-- list_personal_expenses: copied from 0072_personal_expense_gst_rate.sql; current_date -> india_today() (2), nothing else changed.
create or replace function list_personal_expenses(
  p_search   text default null,
  p_category text default null,
  p_cursor   timestamptz default null,
  p_limit    int default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_user    uuid := auth.uid();
  v_limit   int  := greatest(1, least(p_limit, 200));
  v_items   jsonb;
  v_summary jsonb;
  v_next    timestamptz;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select jsonb_agg(row_to_json(pe)) into v_items
  from (
    select pe.id, pe.company_id, pe.user_id, pe.party_id,
           pa.name as party_name,
           pe.amount, pe.expense_date, pe.category, pe.gst_treatment, pe.gst_rate,
           pe.description, pe.created_at
      from personal_expense pe
      left join parties pa on pa.id = pe.party_id
     where pe.company_id = v_company
       and pe.user_id = v_user
       and (p_search is null or pe.description ilike '%' || p_search || '%')
       and (p_category is null or pe.category = p_category)
       and (p_cursor is null or pe.created_at < p_cursor)
     order by pe.created_at desc
     limit v_limit + 1
  ) pe;

  -- Get the cursor for next page
  if coalesce(jsonb_array_length(v_items), 0) > v_limit then
    v_items := v_items - (-1);
    v_next := (v_items->-1->>'created_at')::timestamptz;
  else
    v_next := null;
  end if;

  -- Summary: total count/amount and this month
  select jsonb_build_object(
    'total_count', count(*)::int,
    'total_amount', coalesce(sum(amount), 0)::numeric,
    'this_month_count', count(*) filter (where expense_date >= date_trunc('month', india_today()))::int,
    'this_month_amount', coalesce(sum(amount) filter (where expense_date >= date_trunc('month', india_today())), 0)::numeric
  ) into v_summary
  from personal_expense
  where company_id = v_company and user_id = v_user;

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'summary', v_summary,
    'next_cursor', to_jsonb(v_next)
  );
end;
$$;

-- list_reminders: copied from 0181_reminders.sql; current_date -> india_today() (1), nothing else changed.
create or replace function list_reminders(
  p_status      text default null,
  p_priority    text default null,
  p_user_id     uuid default null,
  p_entity_type text default null,
  p_entity_id   uuid default null,
  p_due_from    timestamptz default null,
  p_due_to      timestamptz default null,
  p_overdue     boolean default null,
  p_search      text default null,
  p_limit       int default 50,
  p_cursor      timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_items   jsonb;
  v_summary jsonb;
  v_needle  text;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_needle := case when nullif(trim(coalesce(p_search, '')), '') is null
                   then null else '%' || trim(p_search) || '%' end;

  select jsonb_agg(row_to_json(r)) into v_items
  from (
    select rm.id, rm.company_id, rm.user_id, rm.created_by, rm.title, rm.description, rm.priority, rm.status,
           rm.entity_type, rm.entity_id, rm.due_at, rm.created_at,
           case rm.entity_type
             when 'lead' then (select l.name from crm_leads l where l.id = rm.entity_id and l.company_id = rm.company_id)
             when 'project' then (select p.name from projects p where p.id = rm.entity_id and p.company_id = rm.company_id)
             when 'client' then (select c.name from clients c where c.id = rm.entity_id and c.company_id = rm.company_id)
             when 'invoice' then (select i.invoice_number from invoices i where i.id = rm.entity_id and i.company_id = rm.company_id)
             when 'enquiry' then (select e.name from enquiries e where e.id = rm.entity_id and e.company_id = rm.company_id)
             when 'task' then (select t.title from tasks t where t.id = rm.entity_id and t.company_id = rm.company_id)
             when 'shoot' then (select s.name from shoots s where s.id = rm.entity_id and s.company_id = rm.company_id)
             when 'deliverable' then (select d.title from deliverables d where d.id = rm.entity_id and d.company_id = rm.company_id)
             else null
           end as entity_name
      from reminders rm
     where rm.company_id = v_company
       and (p_status is null or rm.status = p_status)
       and (p_priority is null or rm.priority = p_priority)
       and (p_user_id is null or rm.user_id = p_user_id)
       and (p_entity_type is null or rm.entity_type = p_entity_type)
       and (p_entity_id is null or rm.entity_id = p_entity_id)
       and (p_due_from is null or rm.due_at >= p_due_from)
       and (p_due_to is null or rm.due_at <= p_due_to)
       and (p_overdue is null or not p_overdue or (rm.status = 'active' and rm.due_at < now()))
       and (v_needle is null or rm.title ilike v_needle or coalesce(rm.description, '') ilike v_needle)
       and (p_cursor is null or rm.created_at < p_cursor)
     order by
       case rm.priority when 'urgent' then 1 when 'high' then 2 when 'medium' then 3 else 4 end,
       rm.due_at nulls last,
       rm.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 50))
  ) r;

  select jsonb_build_object(
    'total_count', count(*)::int,
    'active_count', count(*) filter (where status = 'active')::int,
    'overdue_count', count(*) filter (where status = 'active' and due_at < now())::int,
    'due_today_count', count(*) filter (where status = 'active' and due_at::date = india_today())::int
  ) into v_summary
  from reminders
  where company_id = v_company and (p_user_id is null or user_id = p_user_id);

  return jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'summary', v_summary
  );
end;
$$;

-- next_receipt_number: copied from 0170_billing_reshape.sql; current_date -> india_today() (1), nothing else changed.
create or replace function next_receipt_number(p_company uuid, p_date date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fy text := fy_label(coalesce(p_date, india_today()));
  v_n int;
begin
  insert into receipt_counters (company_id, fy, next_no) values (p_company, v_fy, 1)
  on conflict (company_id, fy) do update set next_no = receipt_counters.next_no + 1
  returning next_no into v_n;
  return 'RCP-' || v_fy || '-' || lpad(v_n::text, 4, '0');
end;
$$;

-- received_payments_receipt_number: copied from 0170_billing_reshape.sql; current_date -> india_today() (1), nothing else changed.
create or replace function received_payments_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' and new.receipt_number is null then
    new.receipt_number := next_receipt_number(new.company_id, coalesce(new.date_received, new.paid_on, india_today()));
  end if;
  return new;
end;
$$;

-- record_invoice_payment: copied from 0145_unify_payment_ledger.sql; current_date -> india_today() (1), nothing else changed.
create or replace function record_invoice_payment(
  p_invoice_id uuid,
  p_amount     numeric,
  p_paid_on    date default null,
  p_mode       text default null,
  p_reference  text default null,
  p_notes      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_inv     invoices;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_inv from invoices where id = p_invoice_id and company_id = v_company;
  if v_inv.id is null then
    raise exception 'invoice not in this studio' using errcode = '42501';
  end if;

  insert into received_payments
    (company_id, invoice_id, project_id, client_id, amount, paid_on,
     mode, reference, notes, status, is_gst, recorded_by)
  values (v_company, p_invoice_id, v_inv.project_id, v_inv.client_id, p_amount,
          coalesce(p_paid_on, india_today()), p_mode, p_reference,
          nullif(trim(p_notes), ''), 'paid', false, auth.uid());
end;
$$;

-- run_crm_followup_cron: copied from 0209_crm_open_fields.sql; current_date -> india_today() (2), nothing else changed.
create or replace function run_crm_followup_cron(p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run uuid;
  v_r record;
  v_d record;
  v_overdue int := 0;
  v_notified int := 0;
  v_unassigned int := 0;
  v_digests int := 0;
  v_rules int := 0;
  v_to uuid;
  v_cadences jsonb;
  v_sla jsonb;
  v_tasks jsonb;
  v_quotes jsonb;
  v_workflows jsonb;
  v_cold jsonb;
  v_summary jsonb;
begin
  insert into cron_runs (job_name, dry_run) values ('crm_followup_cron', p_dry_run) returning id into v_run;

  v_cadences := crm_advance_cadences(p_dry_run);
  v_sla := crm_sla_sweep(p_dry_run);
  v_tasks := crm_task_reminders(p_dry_run);
  v_quotes := crm_expire_quotes(p_dry_run);
  v_cold := crm_cold_sweep(p_dry_run);

  for v_r in
    select l.id, l.company_id, l.assigned_to, l.name, l.phone, l.follow_up_at
    from crm_leads l
    where l.is_archived = false
      and l.status not in ('converted', 'lost')
      and l.follow_up_at is not null
      and l.follow_up_at < now()
  loop
    v_overdue := v_overdue + 1;
    if v_r.assigned_to is null then v_unassigned := v_unassigned + 1; end if;
    if p_dry_run then continue; end if;
    -- 0209: a hand-written task due at this very time alerts on its own.
    if v_r.assigned_to is not null and not exists (
         select 1 from crm_activities a
          where a.lead_id = v_r.id and a.type = 'task' and a.done_at is null
            and a.due_at = v_r.follow_up_at and coalesce(a.meta->>'auto', '') <> 'true') then
      if create_notification(
           v_r.company_id, v_r.assigned_to, 'crm_overdue',
           'Follow-up overdue: ' || coalesce(v_r.name, v_r.phone, 'unnamed lead'),
           'Promised for ' || to_char(v_r.follow_up_at, 'DD Mon HH24:MI'),
           'crm_overdue:' || v_r.id::text || ':' || india_today()::text,
           'crm_lead', v_r.id)
      then
        v_notified := v_notified + 1;
      end if;
    end if;
    v_rules := v_rules + crm_enroll_workflows(v_r.id, 'follow_up_overdue', null);
  end loop;

  -- One line per company per day, and only when there is something to say.
  if not p_dry_run then
    for v_d in
      select l.company_id, count(*) as n
        from crm_leads l
       where l.is_archived = false
         and l.status not in ('converted', 'lost')
         and l.assigned_to is null
         and l.follow_up_at is not null
         and l.follow_up_at < now()
       group by l.company_id
    loop
      v_to := crm_alert_recipient(v_d.company_id, null);
      if v_to is not null then
        if create_notification(
             v_d.company_id, v_to, 'crm_overdue',
             v_d.n || case when v_d.n = 1 then ' overdue lead has nobody on it' else ' overdue leads have nobody on them' end,
             'They were promised a follow-up and are not assigned to anyone.',
             'crm_overdue_unassigned:' || india_today()::text,
             null, null)
        then
          v_digests := v_digests + 1;
        end if;
      end if;
    end loop;
  end if;

  v_workflows := crm_run_workflows(p_dry_run);

  v_summary := jsonb_build_object('overdue', v_overdue, 'notified', v_notified,
                                  'unassigned', v_unassigned, 'digests', v_digests,
                                  'rules_applied', v_rules,
                                  'cadences', v_cadences, 'sla', v_sla, 'tasks', v_tasks,
                                  'quotes', v_quotes, 'workflows', v_workflows, 'cold', v_cold,
                                  'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;

-- run_deliverable_due_cron: copied from 0162_deliverables_billing_and_reminders.sql; current_date -> india_today() (3), nothing else changed.
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
       and (d.estimated_date - india_today()) in (1, 0, -1)
  loop
    v_due := v_due + 1;
    v_days := v_r.estimated_date - india_today();
    if not p_dry_run then
      if create_notification(
           v_r.company_id, v_r.assignee_id, 'deliverable_due',
           v_r.title || case v_days when 1 then ' is due tomorrow'
                                    when 0 then ' is due today'
                                    else ' is late' end,
           v_r.project_name,
           'deliverable_due:' || v_r.id || ':' || india_today(),
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

-- run_notification_generator: copied from 0182_reminder_fixes.sql; current_date -> india_today() (3), nothing else changed.
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
      -- remind_at/done went in 0060: a reminder is due_at + status now.
      -- Same dedupe key as the hourly run_reminder_cron (0181), so running
      -- this by hand never alerts twice for one reminder.
      select rm.id, rm.user_id, rm.title, rm.due_at
        from reminders rm
       where rm.company_id = v_company and rm.status = 'active'
         and rm.due_at between v_from and least(v_to, now())
    loop
      v_scanned := v_scanned + 1;
      if not p_dry_run then
        v_made := create_notification(
          v_company, r.user_id, 'reminder', r.title, 'Reminder due',
          'reminder:' || r.id, 'reminder', r.id, 'warning', '/reminders');
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
         and t.due_date < india_today()
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
         and s.shoot_date between india_today() and least(v_to, now() + interval '7 days')::date
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
         and i.due_date < india_today()
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

-- run_work_submission_reminder_cron: copied from 0068_work_submission_reminders.sql; current_date -> india_today() (2), nothing else changed.
create or replace function run_work_submission_reminder_cron(p_dry_run boolean default false)
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
begin
  insert into cron_runs (job_name, dry_run) values ('work_submission_reminder_cron', p_dry_run) returning id into v_run;

  for v_r in
    select t.id as task_id, t.company_id, t.title, a.user_id
      from tasks t
      join task_assignees a on a.task_id = t.id
      join work_submission_reminder_settings s on s.company_id = t.company_id and s.enabled
     where t.due_date is not null
       and t.status not in ('completed', 'cancelled')
       and (t.due_date - india_today()) = any (s.reminder_days)
       and not exists (
         select 1 from team_work_submissions w
          where w.task_id = t.id and w.status <> 'rejected'
       )
  loop
    v_due := v_due + 1;
    if not p_dry_run then
      if create_notification(v_r.company_id, v_r.user_id, 'work_reminder',
           v_r.title || ' is due soon — submit your work', null,
           'work_reminder:' || v_r.task_id || ':' || india_today(), 'task', v_r.task_id) then
        v_created := v_created + 1;
      end if;
    end if;
  end loop;

  v_summary := jsonb_build_object('tasks_due', v_due, 'notifications_created', v_created, 'dry_run', p_dry_run);
  update cron_runs set finished_at = now(), summary = v_summary where id = v_run;
  return v_summary;
end;
$$;

-- ── 3. a plan given for later waits for the current one ──────────────
alter table companies
  add column if not exists plan_next text,
  add column if not exists plan_next_from timestamptz;

-- platform_assign_plan: copied from 0306_assign_plan_start_today.sql. Changed:
-- a different plan given "after the current plan" while one is running is
-- kept as plan_next (from the current plan's end) instead of replacing
-- companies.plan now; a pending plan's own start counts as the current end.
create or replace function platform_assign_plan(p_company_id uuid, p_plan_key text, p_start_today boolean default false)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    plans;
  v_base    timestamptz;
  v_expires timestamptz;
  v_old     companies;
  v_end     timestamptz;
  v_later   boolean;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  select * into v_plan from plans where key = p_plan_key;
  if not found then
    raise exception 'unknown plan' using errcode = '22023';
  end if;
  select * into v_old from companies where id = p_company_id for update;
  if not found then
    raise exception 'unknown studio' using errcode = '42501';
  end if;
  -- When the plan running now ends: a plan already waiting starts there.
  v_end := coalesce(v_old.plan_next_from, v_old.plan_expiry);
  v_later := not p_start_today
             and v_end is not null and v_end > now()
             and v_old.plan is distinct from v_plan.key;
  v_base := case when p_start_today then now() else greatest(now(), coalesce(v_end, now())) end;
  v_expires := case
                 when v_plan.duration_days is not null then v_base + make_interval(days => v_plan.duration_days)
                 when v_plan.billing_interval = 'yearly' then v_base + interval '12 months'
                 else v_base + interval '1 month'
               end;
  if v_later then
    update companies
       set plan_expiry = v_expires,
           plan_next = v_plan.key,
           plan_next_from = v_end
     where id = p_company_id;
  else
    update companies
       set plan = v_plan.key,
           plan_expiry = v_expires,
           plan_period_start = case
             when p_start_today
               or v_old.plan is distinct from v_plan.key
               or v_old.plan_expiry is null or v_old.plan_expiry <= now()
               or v_old.plan_period_start is null then now()
             else v_old.plan_period_start
           end,
           plan_next = null,
           plan_next_from = null
     where id = p_company_id;
  end if;
  insert into company_subscriptions (company_id, plan_id, expires_at)
    values (p_company_id, v_plan.id, v_expires);
  insert into billing_events (company_id, kind, detail)
    values (p_company_id, 'platform_plan_assigned',
            jsonb_build_object('plan', v_plan.key, 'by', auth.uid(), 'new_expiry', v_expires, 'start_today', p_start_today,
                               'starts_at', case when v_later then v_end end));
  return v_expires;
end;
$$;

-- The five-minute messages tick: a waiting plan starts once its day comes,
-- with a new plan year from that day. Brands follow by their trigger.
create or replace function apply_pending_plans()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  with due as (
    update companies
       set plan = plan_next,
           plan_period_start = plan_next_from,
           plan_next = null,
           plan_next_from = null
     where plan_next is not null and plan_next_from <= now()
    returning id
  )
  select count(*)::int into v_n from due;
  return v_n;
end;
$$;
revoke all on function apply_pending_plans() from public, anon, authenticated;
grant execute on function apply_pending_plans() to service_role;
