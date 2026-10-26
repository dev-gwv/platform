-- 0284: whatever is made can be changed back (owner, 26 Oct: "once they create
-- the invoice, they are not able to edit it back ... they should be able to
-- undo it or change it whenever it is required").
--
-- 1. update_invoice (copied from 0120, the latest): an invoice with money on
--    it can be edited -- lines, client, dates, all of it -- as long as its new
--    total is not below what has already been received (then a payment has to
--    be moved or removed first, which the error says). Only a cancelled one
--    is refused; it is reopened first (below). The totals are worked out
--    again from the ledger, so "paid"/"partial" follows the new total.
-- 2. recompute_invoice_totals (copied from 0145): a cancelled invoice stays
--    cancelled when a payment is moved onto it (that silently un-cancelled it).
-- 3. reopen_invoice(): a cancelled invoice comes back as sent, its totals
--    from the ledger. Money moved off it at cancelling stays where it is.
-- 4. payroll_reopen(): an approved month goes back to draft while nobody in
--    it is marked paid, so its lines can be worked out and adjusted again.
-- 5. payroll_unmark_paid(): a line marked paid by mistake goes back to
--    unpaid (with its salary record), and a paid month back to approved.
-- 6. How invoices are numbered (owner, 26 Oct: "the automatic invoicing
--    number has to be taken according to the date, or manually"):
--    companies.invoice_number_mode -- 'running' (INV-0042, as before),
--    'date' (the prefix and the invoice's date, INV-20261026, then
--    INV-20261026-2 for a second one that day) or 'manual' (the studio types
--    every number; a blank one is refused). create_invoice copied from 0120.
--
-- Safe to run twice: create or replace, same argument lists.

-- ── 1. update_invoice ─────────────────────────────────────────────
create or replace function update_invoice(
  p_invoice_id      uuid,
  p_client_id       uuid,
  p_project_id      uuid,
  p_place_of_supply text,
  p_intra_state     boolean,
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
  p_discount_type   text default null,
  p_bank_details    text default null,
  p_terms           text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_status  text;
  v_paid    numeric;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_template_id is not null and not exists (
    select 1 from invoice_templates where invoice_templates.id = p_template_id and company_id = v_company
  ) then
    raise exception 'template not in this studio' using errcode = '42501';
  end if;

  select status into v_status
    from invoices where id = p_invoice_id and company_id = v_company;

  if v_status is null then
    raise exception 'invoice not in this studio' using errcode = '42501';
  end if;
  if v_status = 'cancelled' then
    raise exception 'a cancelled invoice cannot be edited; reopen it first' using errcode = '23514';
  end if;
  -- Money in hand only (0145): a promise does not hold the total up.
  select coalesce(sum(amount), 0) into v_paid
    from received_payments where invoice_id = p_invoice_id and status = 'paid';
  if p_total + 0.005 < v_paid then
    raise exception 'the new total is less than the % already received', v_paid using errcode = '23514';
  end if;

  update invoices set
    client_id = p_client_id,
    project_id = p_project_id,
    place_of_supply = p_place_of_supply,
    intra_state = p_intra_state,
    invoice_date = coalesce(p_invoice_date, invoice_date),
    due_date = p_due_date,
    subtotal = p_subtotal,
    discount = p_discount,
    discount_type = coalesce(nullif(trim(p_discount_type), ''), discount_type, 'flat'),
    taxable = p_taxable,
    tax = p_tax,
    total = p_total,
    balance_due = greatest(0, p_total - v_paid),
    notes = p_notes,
    bank_details = nullif(trim(p_bank_details), ''),
    terms = nullif(trim(p_terms), ''),
    template_id = p_template_id
  where id = p_invoice_id;

  delete from invoice_items where invoice_id = p_invoice_id;

  insert into invoice_items (invoice_id, company_id, description, subtext, quantity, rate, amount,
    gst_rate, taxable, cgst, sgst, igst, sort_order)
  select p_invoice_id, v_company, e ->> 'description', nullif(e ->> 'subtext', ''),
    (e ->> 'quantity')::numeric, (e ->> 'rate')::numeric, (e ->> 'amount')::numeric,
    (e ->> 'gst_rate')::numeric, (e ->> 'taxable')::numeric,
    (e ->> 'cgst')::numeric, (e ->> 'sgst')::numeric, (e ->> 'igst')::numeric,
    (ord - 1)::int
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(e, ord);

  -- Paid / part paid / sent follows the new total.
  perform recompute_invoice_totals(p_invoice_id);
end;
$$;

-- ── 2. recompute_invoice_totals: cancelled stays cancelled ─────────
create or replace function recompute_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_paid  numeric;
begin
  if p_invoice_id is null then return; end if;
  select total into v_total from invoices where id = p_invoice_id;
  if v_total is null then return; end if;
  -- Only money in hand. A row marked `pending` is a promise, which is what
  -- the payments screen calls "what is still pending" — an invoice settled by
  -- one of those would be reporting a payment nobody has received.
  select coalesce(sum(amount), 0) into v_paid
    from received_payments
   where invoice_id = p_invoice_id and status = 'paid';
  update invoices
     set amount_paid = v_paid,
         balance_due = case when status = 'cancelled' then 0 else greatest(0, v_total - v_paid) end,
         status = case
                    -- A cancelled invoice stays cancelled (0284); it is
                    -- reopened on purpose, never by a payment landing on it.
                    when status = 'cancelled' then status
                    when v_paid >= v_total then 'paid'
                    when v_paid > 0 then 'partial'
                    -- Back to its pre-payment state if every payment is
                    -- removed; 'sent' rather than 'draft', because an
                    -- invoice that has been paid was certainly sent.
                    else case when status in ('paid', 'partial') then 'sent' else status end
                  end
   where id = p_invoice_id;
end;
$$;

-- ── 3. reopen a cancelled invoice ─────────────────────────────────
create or replace function reopen_invoice(p_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_status  text;
begin
  if not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select status into v_status from invoices where id = p_invoice_id and company_id = v_company;
  if v_status is null then
    raise exception 'invoice not in this studio' using errcode = '42501';
  end if;
  if v_status <> 'cancelled' then
    return v_status;
  end if;
  update invoices set status = 'sent' where id = p_invoice_id;
  perform recompute_invoice_totals(p_invoice_id);
  return (select status from invoices where id = p_invoice_id);
end;
$$;
revoke all on function reopen_invoice(uuid) from public, anon;
grant execute on function reopen_invoice(uuid) to authenticated, service_role;

-- ── 4. an approved payroll month back to draft ────────────────────
create or replace function payroll_reopen(p_company uuid, p_run uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run payroll_runs;
begin
  select * into v_run from payroll_runs where id = p_run and company_id = p_company for update;
  if not found then
    raise exception 'that payroll was not found' using errcode = 'P0002';
  end if;
  if v_run.status = 'draft' then
    return;
  end if;
  if exists (select 1 from payroll_lines where run_id = p_run and paid_at is not null) then
    raise exception 'someone in this month is already marked paid; undo that first' using errcode = '22023';
  end if;
  update payroll_runs set status = 'draft', approved_by = null, approved_at = null, paid_at = null where id = p_run;
  update payroll_lines set released = false where run_id = p_run;
end;
$$;
revoke all on function payroll_reopen(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function payroll_reopen(uuid, uuid, uuid) to service_role;

-- ── 5. a line marked paid by mistake, back to unpaid ──────────────
create or replace function payroll_unmark_paid(p_company uuid, p_run uuid, p_line uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run payroll_runs;
  v_l   payroll_lines;
begin
  select * into v_run from payroll_runs where id = p_run and company_id = p_company for update;
  if not found then
    raise exception 'that payroll was not found' using errcode = 'P0002';
  end if;
  select * into v_l from payroll_lines where id = p_line and run_id = p_run;
  if not found then
    raise exception 'that line was not found' using errcode = 'P0002';
  end if;
  if v_l.paid_at is null then
    return;
  end if;
  update payroll_lines
     set paid_amount = 0, paid_at = null, payment_mode = null, payment_reference = null, updated_at = now()
   where id = p_line;
  -- The salary record payroll wrote for this person and month follows.
  update monthly_salaries
     set paid_amount = 0, status = 'unpaid'
   where company_id = p_company and user_id = v_l.user_id
     and ((pay_year = v_run.pay_year and pay_month = v_run.pay_month)
          or month = make_date(v_run.pay_year, v_run.pay_month, 1));
  perform payroll_refresh_totals(p_run);
  update payroll_runs set status = 'approved', paid_at = null where id = p_run and status = 'paid';
end;
$$;
revoke all on function payroll_unmark_paid(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function payroll_unmark_paid(uuid, uuid, uuid, uuid) to service_role;

-- ── 6. invoice numbering: running, by date, or typed ──────────────
alter table companies add column if not exists invoice_number_mode text not null default 'running';
do $$ begin
  alter table companies add constraint companies_invoice_number_mode_chk
    check (invoice_number_mode in ('running', 'date', 'manual'));
exception when duplicate_object then null; end $$;

create or replace function next_invoice_number_on(p_date date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_mode    text;
  v_prefix  text;
  v_base    text;
  v_try     text;
  v_n       int := 1;
begin
  select invoice_number_mode, coalesce(invoice_number_prefix, '') into v_mode, v_prefix
    from companies where id = v_company;
  if v_mode = 'manual' then
    raise exception 'type the invoice number' using errcode = '23514';
  end if;
  if v_mode is distinct from 'date' then
    return next_invoice_number();
  end if;
  v_base := v_prefix || to_char(coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date), 'YYYYMMDD');
  v_try := v_base;
  while exists (select 1 from invoices where company_id = v_company and invoice_number = v_try) loop
    v_n := v_n + 1;
    v_try := v_base || '-' || v_n;
  end loop;
  return v_try;
end;
$$;
revoke all on function next_invoice_number_on(date) from public, anon;
grant execute on function next_invoice_number_on(date) to authenticated, service_role;

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
    values (v_company, p_client_id, p_project_id, v_number, coalesce(p_invoice_date, current_date),
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
