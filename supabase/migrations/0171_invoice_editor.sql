-- 0171: the invoice editor a studio expects from a proper billing tool.
--
-- * Each line carries its HSN/SAC code, and lines keep the order they were
--   typed in (they were read back ordered by a random id).
-- * An invoice has a subject line and payment terms ("Net 15").
-- * A studio keeps a catalogue of items it bills again and again: name, the
--   line under it, rate, HSN/SAC and GST rate, picked into a line in one tap.
-- * Files go out with an invoice (a quotation, a shot list): attached here,
--   downloadable by the client from the invoice link.

alter table invoice_items add column if not exists hsn_sac text;
alter table invoices add column if not exists subject text;
alter table invoices add column if not exists payment_terms text;

create table if not exists invoice_item_presets (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 200),
  description text,
  rate        numeric(12, 2) not null default 0 check (rate >= 0),
  hsn_sac     text,
  gst_rate    numeric(5, 2) not null default 0 check (gst_rate in (0, 5, 12, 18, 28)),
  kind        text not null default 'service' check (kind in ('service', 'goods')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (company_id, name)
);
create index if not exists invoice_item_presets_company_idx on invoice_item_presets (company_id);

create table if not exists invoice_attachments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  invoice_id  uuid not null references invoices (id) on delete cascade,
  file_id     uuid not null references files (id) on delete cascade,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (invoice_id, file_id)
);
create index if not exists invoice_attachments_invoice_idx on invoice_attachments (invoice_id);

-- An attachment belongs to the invoice's studio, and so must its file:
-- neither id can be borrowed from another studio.
create or replace function invoice_attachments_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_company uuid;
begin
  select company_id into v_company from invoices where id = new.invoice_id;
  if v_company is null then
    raise exception 'invoice not found' using errcode = '23503';
  end if;
  if v_company is distinct from get_current_company_id() and auth.uid() is not null then
    raise exception 'invoice not in this studio' using errcode = '42501';
  end if;
  new.company_id := v_company;
  if not exists (select 1 from files where id = new.file_id and company_id = v_company) then
    raise exception 'file not in this studio' using errcode = '42501';
  end if;
  if new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end;
$$;
drop trigger if exists invoice_attachments_fill on invoice_attachments;
create trigger invoice_attachments_fill
  before insert on invoice_attachments
  for each row execute function invoice_attachments_fill();

alter table invoice_item_presets enable row level security;
alter table invoice_attachments  enable row level security;

drop policy if exists invoice_item_presets_select on invoice_item_presets;
create policy invoice_item_presets_select on invoice_item_presets for select to authenticated
  using (company_id = get_current_company_id());
drop policy if exists invoice_item_presets_write on invoice_item_presets;
create policy invoice_item_presets_write on invoice_item_presets for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());
drop policy if exists invoice_attachments_select on invoice_attachments;
create policy invoice_attachments_select on invoice_attachments for select to authenticated
  using (company_id = get_current_company_id());
drop policy if exists invoice_attachments_write on invoice_attachments;
create policy invoice_attachments_write on invoice_attachments for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active());

grant select, insert, update, delete on invoice_item_presets to authenticated;
grant select, insert, update, delete on invoice_attachments to authenticated;

-- 0170 body, plus subject, payment terms, per-line HSN/SAC in typed order,
-- and the attached files.
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
          'cgst', it.cgst, 'sgst', it.sgst, 'igst', it.igst, 'hsn_sac', it.hsn_sac) order by it.sort_order, it.id)
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

-- One attached file, read through the invoice link: the token must be live,
-- the invoice sent, and the file attached to that very invoice.
create or replace function invoice_attachment_for_token(p_raw text, p_file uuid)
returns table (name text, mime text, bytes bytea)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
begin
  return query
  select f.name, f.mime, f.bytes
    from access_tokens at
    join invoices i on i.id = at.subject_id and i.company_id = at.company_id
    join invoice_attachments ia on ia.invoice_id = i.id
    join files f on f.id = ia.file_id
   where at.purpose = 'invoice'
     and at.token_hash = v_hash
     and (at.expires_at is null or at.expires_at > now())
     and at.revoked_at is null
     and i.status not in ('cancelled', 'draft')
     and f.id = p_file
   limit 1;
end;
$$;

revoke all on function get_invoice_for_token(text) from public;
grant execute on function get_invoice_for_token(text) to anon, authenticated, service_role;
revoke all on function invoice_attachment_for_token(text, uuid) from public;
grant execute on function invoice_attachment_for_token(text, uuid) to anon, authenticated, service_role;
