-- 0170: Billing in four heads -- Invoices, Payments received, Expenses,
-- Profit & Loss. What the database needs for that:
--
--   1. Receipt numbers. Every received payment gets a number in a series per
--      financial year (RCP-2026-27-0001), the way an accountant expects, in
--      place of the first eight characters of its id.
--   2. One expenses ledger. The "personal expenses" table was the richer one
--      (vendor, GST, attachments) but belonged to one person each; its rows are
--      copied into `expenses` marked with who paid, so out-of-pocket costs can
--      be paid back. The old table is left in place, untouched.
--   3. SAC 998387 (photography services) on GST invoices, editable per studio.
--
-- Nothing is dropped except the reconciliation function nothing calls.

-- ── 1. Receipt numbers ────────────────────────────────────────────────────
alter table received_payments add column if not exists receipt_number text;
create unique index if not exists received_payments_receipt_number_idx
  on received_payments (company_id, receipt_number) where receipt_number is not null;

-- '2026-27' for any date from 1 Apr 2026 to 31 Mar 2027.
create or replace function fy_label(d date)
returns text
language sql
immutable
as $$
  select case when extract(month from d) >= 4
              then extract(year from d)::int::text || '-' || lpad(((extract(year from d)::int + 1) % 100)::text, 2, '0')
              else (extract(year from d)::int - 1)::text || '-' || lpad((extract(year from d)::int % 100)::text, 2, '0')
         end
$$;

-- One counter per studio and year. Upsert-with-returning hands out each
-- number exactly once, even when two payments are recorded at the same moment.
create table if not exists receipt_counters (
  company_id uuid not null references companies (id) on delete cascade,
  fy         text not null,
  next_no    int  not null default 0,
  primary key (company_id, fy)
);
alter table receipt_counters enable row level security;
drop policy if exists receipt_counters_select on receipt_counters;
create policy receipt_counters_select on receipt_counters
  for select to authenticated using (company_id = get_current_company_id());

create or replace function next_receipt_number(p_company uuid, p_date date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fy text := fy_label(coalesce(p_date, current_date));
  v_n int;
begin
  insert into receipt_counters (company_id, fy, next_no) values (p_company, v_fy, 1)
  on conflict (company_id, fy) do update set next_no = receipt_counters.next_no + 1
  returning next_no into v_n;
  return 'RCP-' || v_fy || '-' || lpad(v_n::text, 4, '0');
end;
$$;

-- A payment is numbered the moment it is received: on insert as paid, or
-- when a promised payment is marked received. A number, once given, stays.
create or replace function received_payments_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid' and new.receipt_number is null then
    new.receipt_number := next_receipt_number(new.company_id, coalesce(new.date_received, new.paid_on, current_date));
  end if;
  return new;
end;
$$;
drop trigger if exists received_payments_receipt_number_trg on received_payments;
create trigger received_payments_receipt_number_trg
  before insert or update of status on received_payments
  for each row execute function received_payments_receipt_number();

-- Money already received gets its numbers in the order it came in.
do $$
declare r record;
begin
  for r in
    select id, company_id, coalesce(date_received, paid_on) as d
      from received_payments
     where status = 'paid' and receipt_number is null
     order by company_id, coalesce(date_received, paid_on), created_at
  loop
    update received_payments set receipt_number = next_receipt_number(r.company_id, r.d) where id = r.id;
  end loop;
end $$;

-- The receipt the client opens shows the real number (0146 body, one column changed).
drop function if exists get_receipt_for_token(text);
create function get_receipt_for_token(p_raw text)
returns table (
  amount numeric, paid_on date, mode text, reference text,
  project_name text, client_name text, company_name text,
  total_cost numeric, received_total numeric,
  logo_url text, gstin text, company_phone text, company_email text, company_address text,
  description text, status text, access_count int, revoked boolean, expires_at timestamptz,
  company_legal_name text, company_website text, document_footer_note text,
  client_phone text, client_email text, client_address text,
  receipt_number text, is_gst boolean, payment_gst_number text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_payment uuid;
  v_expires timestamptz;
  v_count int;
begin
  select at.subject_id, at.expires_at, coalesce(at.access_count, 0)
    into v_payment, v_expires, v_count
    from access_tokens at
   where at.purpose = 'receipt'
     and at.token_hash = v_hash
     and (at.expires_at is null or at.expires_at > now())
     and at.revoked_at is null
   limit 1;
  if v_payment is null then
    return;
  end if;

  update access_tokens at set access_count = coalesce(at.access_count, 0) + 1
   where at.purpose = 'receipt' and at.token_hash = v_hash;

  return query
  select rp.amount, coalesce(rp.date_received, rp.paid_on), rp.mode, rp.reference,
         p.name, cl.name, coalesce(co.display_name, co.name), p.total_cost,
         (select coalesce(sum(x.amount), 0) from received_payments x where x.project_id = p.id and x.status = 'paid'),
         coalesce(co.invoice_logo_url, co.avatar_url), co.invoice_gst_number,
         co.invoice_phone, co.invoice_email, co.invoice_address,
         coalesce(rp.description, rp.notes), coalesce(rp.status, 'paid'),
         v_count + 1, false, v_expires,
         co.legal_name, co.website, co.document_footer_note,
         cl.phone, cl.email, cl.address,
         coalesce(rp.receipt_number, 'R-' || upper(substring(rp.id::text, 1, 8))),
         coalesce(rp.is_gst, false), rp.gst_number
    from received_payments rp
    join projects p on p.id = rp.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = rp.company_id
   where rp.id = v_payment;
end;
$$;

-- ── 2. One expenses ledger ────────────────────────────────────────────────
alter table expenses add column if not exists paid_by_user_id uuid references users (user_id) on delete set null;
alter table expenses add column if not exists reimbursement_status text not null default 'none'
  check (reimbursement_status in ('none', 'pending', 'reimbursed'));
alter table expenses add column if not exists reimbursed_at timestamptz;
alter table expenses add column if not exists source_personal_expense_id uuid unique;
create index if not exists expenses_to_reimburse_idx
  on expenses (company_id) where reimbursement_status = 'pending';

alter table expense_attachments add column if not exists file_id uuid references files (id) on delete set null;

-- Copy each person's entries in, once. History is marked 'none', so nothing
-- old lands in "To reimburse" on the first day; the person is kept as who paid.
insert into expenses (
  company_id, project_id, party_id, category, description, amount, expense_date,
  gst_treatment, gst_rate, invoice_number, amount_is, tax_name, tax_amount, reverse_charge, itemize_json,
  created_by, created_at, paid_by_user_id, reimbursement_status, source_personal_expense_id)
select pe.company_id, null, pe.party_id, pe.category, pe.description, pe.amount, pe.expense_date,
       pe.gst_treatment, coalesce(pe.gst_rate, 0), pe.invoice_number, coalesce(pe.amount_is, 'excluding_tax'),
       pe.tax_name, coalesce(pe.tax_amount, 0), coalesce(pe.reverse_charge, false), coalesce(pe.itemize_json, '[]'::jsonb),
       pe.user_id, pe.created_at, pe.user_id, 'none', pe.id
  from personal_expense pe
 where not exists (select 1 from expenses e where e.source_personal_expense_id = pe.id);

update expense_attachments a
   set expense_id = e.id
  from expenses e
 where e.source_personal_expense_id = a.personal_expense_id
   and a.expense_id is null;

-- ── 3. SAC on GST invoices ────────────────────────────────────────────────
alter table companies add column if not exists invoice_sac_code text default '998387';

-- 0169 body with the SAC code added to the studio block.
create or replace function get_invoice_for_token(p_raw text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_invoice uuid;
  v_company uuid;
  v_out jsonb;
begin
  select at.subject_id, at.company_id into v_invoice, v_company
    from access_tokens at
   where at.purpose = 'invoice'
     and at.token_hash = v_hash
     and (at.expires_at is null or at.expires_at > now())
     and at.revoked_at is null
   limit 1;
  if v_invoice is null then
    return null;
  end if;

  select jsonb_build_object(
    'invoice', jsonb_build_object(
      'id', i.id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date,
      'due_date', i.due_date, 'status', i.status, 'place_of_supply', i.place_of_supply,
      'intra_state', i.intra_state, 'client_id', i.client_id, 'project_id', i.project_id,
      'template_id', i.template_id, 'subtotal', i.subtotal, 'discount', i.discount,
      'discount_type', i.discount_type, 'taxable', i.taxable, 'tax', i.tax, 'total', i.total,
      'amount_paid', i.amount_paid, 'balance_due', i.balance_due, 'notes', i.notes,
      'bank_details', i.bank_details, 'terms', i.terms, 'created_at', i.created_at,
      'gst_number', i.gst_number,
      'client_name', cl.name, 'client_gstin', cl.gstin, 'client_address', cl.address,
      'client_phone', cl.phone, 'client_email', cl.email,
      'project_name', pj.name,
      'template_layout', coalesce(
        (select it.layout_json from invoice_templates it where it.id = i.template_id),
        (select it.layout_json from invoice_templates it where it.company_id = i.company_id and it.is_default = true limit 1)),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', it.id, 'description', it.description, 'subtext', it.subtext, 'quantity', it.quantity,
          'rate', it.rate, 'amount', it.amount, 'gst_rate', it.gst_rate,
          'cgst', it.cgst, 'sgst', it.sgst, 'igst', it.igst) order by it.id)
          from invoice_items it where it.invoice_id = i.id), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pmt.id, 'amount', pmt.amount, 'paid_on', pmt.paid_on, 'mode', pmt.mode,
          'reference', null, 'notes', null, 'status', pmt.status) order by pmt.paid_on)
          from received_payments pmt where pmt.invoice_id = i.id and pmt.status = 'paid'), '[]'::jsonb)
    ),
    'company', jsonb_build_object(
      'name', coalesce(co.display_name, co.name), 'legal_name', co.legal_name,
      'city', co.city, 'state', co.state, 'country', co.country,
      'invoice_gst_number', co.invoice_gst_number, 'invoice_address', co.invoice_address,
      'invoice_phone', co.invoice_phone, 'invoice_email', co.invoice_email,
      'invoice_upi_id', co.invoice_upi_id, 'invoice_sac_code', co.invoice_sac_code,
      'logo_url', coalesce(co.invoice_logo_url, co.avatar_url),
      'document_footer_note', co.document_footer_note
    )
  ) into v_out
    from invoices i
    join companies co on co.id = i.company_id
    left join clients cl on cl.id = i.client_id
    left join projects pj on pj.id = i.project_id
   where i.id = v_invoice
     and i.company_id = v_company
     and i.status not in ('cancelled', 'draft');

  if v_out is not null then
    update access_tokens set access_count = coalesce(access_count, 0) + 1
     where purpose = 'invoice' and token_hash = v_hash;
  end if;
  return v_out;
end;
$$;

-- ── 4. Gone ───────────────────────────────────────────────────────────────
drop function if exists reconciliation_summary();
-- The personal-expense screen is folded into Expenses; its readers go with it.
drop function if exists list_personal_expenses(text, text, timestamptz, int);
drop function if exists personal_expense_report(date, date);

-- ── Grants ────────────────────────────────────────────────────────────────
revoke all on function fy_label(date) from public;
grant execute on function fy_label(date) to anon, authenticated, service_role;
revoke all on function next_receipt_number(uuid, date) from public;
grant execute on function next_receipt_number(uuid, date) to authenticated, service_role;
revoke all on function get_receipt_for_token(text) from public;
grant execute on function get_receipt_for_token(text) to anon, authenticated;
revoke all on function get_invoice_for_token(text) from public;
grant execute on function get_invoice_for_token(text) to anon, authenticated, service_role;
