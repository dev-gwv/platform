-- 0169: an invoice link a client can open.
--
-- "Copy link" on an invoice used to copy the studio's own app URL, which asks
-- the client to log in. Receipts already have a public, revocable link
-- (access_tokens, purpose 'receipt'); invoices now get the same, purpose
-- 'invoice', issued and revoked with the generic rotate/revoke helpers.
--
-- The reader has no session, so this is SECURITY DEFINER and scoped entirely
-- by the token: the token's studio must be the invoice's studio, the token
-- must be live, and a cancelled invoice is not shown. Only money that has
-- actually come in is listed as paid.

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
      'invoice_upi_id', co.invoice_upi_id,
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
