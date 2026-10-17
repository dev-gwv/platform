-- 0265 again, because the server may never have run it.
--
-- 0265 was pushed first as a claim: a file holding only its comment header
-- (ce1143d). The VPS migrator (deploy/db/migrate.sh) records each file by
-- name in schema_migrations once it has run, so a deploy taken at that
-- commit ran the empty file and marked 0265 applied; the body pushed after
-- it (221ffa2) was then skipped for good. The API wrote unit and days into
-- columns that did not exist and every quote failed: "We could not create
-- the quote."
--
-- Everything below is 0265's body unchanged, and every statement is safe to
-- run twice (add column if not exists, guarded constraints, create or
-- replace), so a server that did run 0265 in full is not harmed.
alter table crm_quote_items add column if not exists unit text;
alter table crm_quote_items add column if not exists days numeric(10, 2);
alter table invoice_items   add column if not exists unit text;
alter table invoice_items   add column if not exists days numeric(10, 2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_quote_items_unit_len') then
    alter table crm_quote_items add constraint crm_quote_items_unit_len check (unit is null or char_length(unit) <= 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_quote_items_days_pos') then
    alter table crm_quote_items add constraint crm_quote_items_days_pos check (days is null or days > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoice_items_unit_len') then
    alter table invoice_items add constraint invoice_items_unit_len check (unit is null or char_length(unit) <= 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoice_items_days_pos') then
    alter table invoice_items add constraint invoice_items_days_pos check (days is null or days > 0);
  end if;
end $$;

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
    'expired', v_q.valid_until is not null and v_q.valid_until < current_date and v_q.status = 'sent'
  ) into r;
  return r;
end;
$$;
revoke all on function get_quote_for_token(text) from public;
grant execute on function get_quote_for_token(text) to anon, authenticated;

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
      'gst_number', i.gst_number, 'subject', i.subject, 'payment_terms', i.payment_terms,
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
          'cgst', it.cgst, 'sgst', it.sgst, 'igst', it.igst, 'hsn_sac', it.hsn_sac, 'unit', it.unit, 'days', it.days) order by it.sort_order, it.id)
          from invoice_items it where it.invoice_id = i.id), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pmt.id, 'amount', pmt.amount, 'paid_on', pmt.paid_on, 'mode', pmt.mode,
          'reference', null, 'notes', null, 'status', pmt.status) order by pmt.paid_on)
          from received_payments pmt where pmt.invoice_id = i.id and pmt.status = 'paid'), '[]'::jsonb),
      -- Files the studio sent with the invoice (a quotation, a shot list); the
      -- client downloads each through the same link.
      'attachments', coalesce((
        select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'size_bytes', f.size_bytes)
                         order by ia.created_at)
          from invoice_attachments ia join files f on f.id = ia.file_id
         where ia.invoice_id = i.id), '[]'::jsonb)
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
revoke all on function get_invoice_for_token(text) from public;
grant execute on function get_invoice_for_token(text) to anon, authenticated, service_role;

create or replace function client_portal_invoice(p_raw text, p_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_link client_portal_links;
  v_out jsonb;
begin
  v_link := client_portal_link_for_token(p_raw);
  if v_link.id is null or not v_link.show_payments then
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
      'gst_number', i.gst_number, 'subject', i.subject, 'payment_terms', i.payment_terms,
      'client_name', cl.name, 'client_gstin', cl.gstin, 'client_address', cl.address,
      'client_phone', cl.phone, 'client_email', cl.email,
      'project_name', pj.name,
      'template_layout', coalesce(
        (select it.layout_json from invoice_templates it where it.id = i.template_id and it.company_id = i.company_id),
        (select it.layout_json from invoice_templates it where it.company_id = i.company_id and it.is_default = true limit 1)),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', it.id, 'description', it.description, 'subtext', it.subtext, 'quantity', it.quantity,
          'rate', it.rate, 'amount', it.amount, 'gst_rate', it.gst_rate,
          'cgst', it.cgst, 'sgst', it.sgst, 'igst', it.igst, 'hsn_sac', it.hsn_sac, 'unit', it.unit, 'days', it.days) order by it.sort_order, it.id)
          from invoice_items it where it.invoice_id = i.id), '[]'::jsonb),
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pmt.id, 'amount', pmt.amount, 'paid_on', pmt.paid_on, 'mode', pmt.mode,
          'reference', null, 'notes', null, 'status', pmt.status) order by pmt.paid_on)
          from received_payments pmt where pmt.invoice_id = i.id and pmt.status = 'paid'), '[]'::jsonb),
      'attachments', '[]'::jsonb
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
    left join clients cl on cl.id = i.client_id and cl.company_id = i.company_id
    left join projects pj on pj.id = i.project_id
   where i.id = p_invoice
     and i.project_id = v_link.project_id
     and i.company_id = v_link.company_id
     and i.status not in ('cancelled', 'draft');
  return v_out;
end;
$$;
revoke all on function client_portal_invoice(text, uuid) from public, anon, authenticated;
grant execute on function client_portal_invoice(text, uuid) to service_role;
