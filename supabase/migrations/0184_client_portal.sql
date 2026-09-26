-- 0184: the client portal -- one private link per project.
--
-- A couple asks the same four questions all season: when are the shoots, where
-- are our photos, how much do we still owe, what did we agree to. The answers
-- are all in the project; this lets the studio hand the client one link that
-- shows exactly those, and nothing else.
--
-- The model is the invoice / team-terms link:
--   * the raw token is made by the API and exists only in the link the studio
--     shares; the row keeps its SHA-256, so a database read never yields a
--     working link;
--   * one live link per project -- a new one retires the old;
--   * the reader has no session, so it is SECURITY DEFINER and scoped entirely
--     by the token: the token names one project of one studio, and every row
--     it returns is joined back to that project AND that studio.
--
-- What the client never sees: internal deliverables (visibility_scope =
-- 'internal' or not shown on the quotation), cancelled ones, internal notes,
-- deliverable prices, crew pay or contact details (at most a first name and
-- the role, and only when the studio turns that on), expenses, other projects.
-- Money is only the package, what came in, what is left, and the invoices
-- that were actually sent -- and only when the studio leaves "show payments" on.

-- ── the link ─────────────────────────────────────────────────────
create table if not exists client_portal_links (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies (id) on delete cascade,
  project_id     uuid not null references projects (id) on delete cascade,
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  show_payments  boolean not null default true,
  show_team      boolean not null default false,
  allow_feedback boolean not null default true,
  expires_at     timestamptz,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by     uuid references auth.users (id) on delete set null,
  last_viewed_at timestamptz,
  view_count     int not null default 0
);
-- At most one live link per project.
create unique index if not exists client_portal_links_live_idx
  on client_portal_links (project_id) where revoked_at is null;
create index if not exists client_portal_links_company_idx on client_portal_links (company_id, project_id);

alter table client_portal_links enable row level security;
drop policy if exists client_portal_links_select on client_portal_links;
create policy client_portal_links_select on client_portal_links
  for select to authenticated using (company_id = get_current_company_id());
-- Writes go through the functions below only.
grant select on client_portal_links to authenticated;

-- ── what the client said about a deliverable ─────────────────────
create table if not exists client_portal_feedback (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies (id) on delete cascade,
  project_id     uuid not null references projects (id) on delete cascade,
  link_id        uuid references client_portal_links (id) on delete set null,
  deliverable_id uuid not null references deliverables (id) on delete cascade,
  kind           text not null check (kind in ('approved', 'change_requested')),
  message        text check (message is null or char_length(message) <= 2000),
  created_at     timestamptz not null default now()
);
create index if not exists client_portal_feedback_project_idx
  on client_portal_feedback (company_id, project_id, created_at desc);
create index if not exists client_portal_feedback_link_idx
  on client_portal_feedback (link_id, created_at desc);

alter table client_portal_feedback enable row level security;
drop policy if exists client_portal_feedback_select on client_portal_feedback;
create policy client_portal_feedback_select on client_portal_feedback
  for select to authenticated using (company_id = get_current_company_id());
grant select on client_portal_feedback to authenticated;

-- ── studio side ──────────────────────────────────────────────────
-- A new link for a project (the old one, if any, stops working). The API makes
-- the raw token and passes only its hash. `projects.edit` is checked by the API.
create or replace function issue_client_portal_link(
  p_project        uuid,
  p_token_hash     text,
  p_show_payments  boolean default true,
  p_show_team      boolean default false,
  p_allow_feedback boolean default true,
  p_expires_at     timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_id uuid;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from projects p where p.id = p_project and p.company_id = v_company) then
    raise exception 'That project is not in this studio.' using errcode = 'P0002';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The expiry must be in the future.' using errcode = '22023';
  end if;

  update client_portal_links
     set revoked_at = now(), revoked_by = auth.uid()
   where project_id = p_project and company_id = v_company and revoked_at is null;

  insert into client_portal_links (company_id, project_id, token_hash, show_payments, show_team,
                                   allow_feedback, expires_at, created_by)
  values (v_company, p_project, p_token_hash, coalesce(p_show_payments, true),
          coalesce(p_show_team, false), coalesce(p_allow_feedback, true), p_expires_at, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function issue_client_portal_link(uuid, text, boolean, boolean, boolean, timestamptz) from public, anon;
grant execute on function issue_client_portal_link(uuid, text, boolean, boolean, boolean, timestamptz) to authenticated;

-- Stop the project's live link. Returns false when there was none.
create or replace function revoke_client_portal_link(p_project uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_rows int;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update client_portal_links
     set revoked_at = now(), revoked_by = auth.uid()
   where project_id = p_project and company_id = v_company and revoked_at is null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
revoke all on function revoke_client_portal_link(uuid) from public, anon;
grant execute on function revoke_client_portal_link(uuid) to authenticated;

-- Change what the live link shows, without changing the link itself.
-- A null leaves that option as it is; p_clear_expiry removes the expiry.
create or replace function set_client_portal_options(
  p_project        uuid,
  p_show_payments  boolean default null,
  p_show_team      boolean default null,
  p_allow_feedback boolean default null,
  p_expires_at     timestamptz default null,
  p_clear_expiry   boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_rows int;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The expiry must be in the future.' using errcode = '22023';
  end if;
  update client_portal_links
     set show_payments  = coalesce(p_show_payments, show_payments),
         show_team      = coalesce(p_show_team, show_team),
         allow_feedback = coalesce(p_allow_feedback, allow_feedback),
         expires_at     = case when p_clear_expiry then null else coalesce(p_expires_at, expires_at) end
   where project_id = p_project and company_id = v_company and revoked_at is null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
revoke all on function set_client_portal_options(uuid, boolean, boolean, boolean, timestamptz, boolean) from public, anon;
grant execute on function set_client_portal_options(uuid, boolean, boolean, boolean, timestamptz, boolean) to authenticated;

-- ── the reader ───────────────────────────────────────────────────
-- The live link a raw token names, or nothing. Internal: never granted out.
create or replace function client_portal_link_for_token(p_raw text)
returns client_portal_links
language sql
stable
security definer
set search_path = public
as $$
  select l.* from client_portal_links l
    join projects p on p.id = l.project_id and p.company_id = l.company_id
   where l.token_hash = encode(sha256(convert_to(coalesce(p_raw, ''), 'UTF8')), 'hex')
     and l.revoked_at is null
     and (l.expires_at is null or l.expires_at > now())
     and p.status <> 'cancelled'
   limit 1
$$;
revoke all on function client_portal_link_for_token(text) from public, anon, authenticated;

-- A deliverable as the client reads it: not started, in progress, or ready.
create or replace function client_portal_status(p_status text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_status
           when 'pending' then 'not_started'
           when 'in_progress' then 'in_progress'
           when 'review' then 'ready'
           when 'completed' then 'ready'
           else 'not_started'
         end
$$;

-- The whole page. Counts the view.
create or replace function get_client_portal(p_raw text)
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
               'start_at', s.start_at, 'end_at', s.end_at,
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
               'status', client_portal_status(d.status),
               'expected_date', d.estimated_date,
               'delivered_at', d.delivered_at,
               'delivery_link', case when d.status in ('review', 'completed') then nullif(trim(d.delivery_link), '') end,
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
      'balance', greatest(coalesce(p.total_cost, 0) - v_received, 0),
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', i.id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date,
                 'due_date', i.due_date, 'status', i.status, 'total', i.total,
                 'balance_due', i.balance_due) order by i.invoice_date, i.created_at)
          from invoices i
         where i.project_id = p.id and i.company_id = p.company_id
           and i.status not in ('draft', 'cancelled')), '[]'::jsonb)
    ) end,
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

  if v_out is not null then
    update client_portal_links
       set view_count = view_count + 1, last_viewed_at = now()
     where id = v_link.id;
  end if;
  return v_out;
end;
$$;
revoke all on function get_client_portal(text) from public, anon, authenticated;
grant execute on function get_client_portal(text) to service_role;

-- One invoice of the project, in the shape the public invoice page reads
-- (get_invoice_for_token, 0171). Only when the link shows payments, and only a
-- sent invoice of this project. Attachments stay behind the invoice's own link.
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
          'cgst', it.cgst, 'sgst', it.sgst, 'igst', it.igst, 'hsn_sac', it.hsn_sac) order by it.sort_order, it.id)
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

-- One terms document already sent to this client, to read (agreeing stays on
-- the terms link itself). Same columns as get_terms_payload_for_document.
create or replace function client_portal_terms(p_raw text, p_doc uuid)
returns table (
  title text, body text, project_name text, client_name text, client_phone text,
  company_name text, logo_url text, company_phone text, company_email text, company_address text,
  payment_summary text, sections jsonb, expires_at timestamptz, revoked boolean,
  acknowledged_at timestamptz, acknowledged_by_name text, access_count int,
  company_legal_name text, company_website text, document_footer_note text,
  client_email text, client_address text, gstin text,
  document_number text, issued_at timestamptz,
  payment_terms jsonb, total_cost numeric, legal_note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_link client_portal_links;
begin
  v_link := client_portal_link_for_token(p_raw);
  if v_link.id is null then
    return;
  end if;

  return query
  select d.title, d.rendered_body, p.name, cl.name, cl.phone,
         coalesce(co.display_name, co.name),
         coalesce(co.invoice_logo_url, co.avatar_url),
         co.invoice_phone, co.invoice_email, co.invoice_address,
         d.payment_summary, coalesce(d.sections, '[]'::jsonb), null::timestamptz,
         false,
         d.acknowledged_at, d.acknowledged_by_name, 0,
         co.legal_name, co.website, co.document_footer_note,
         cl.email, cl.address, co.invoice_gst_number,
         'T-' || upper(substring(d.id::text, 1, 8)), d.created_at,
         coalesce(d.payment_terms, '[]'::jsonb),
         case when v_link.show_payments then coalesce(d.total_cost, p.total_cost) end,
         d.legal_note
    from project_terms_documents d
    join projects p on p.id = d.project_id and p.company_id = d.company_id
    left join clients cl on cl.id = p.client_id and cl.company_id = p.company_id
    join companies co on co.id = d.company_id
   where d.id = p_doc
     and d.project_id = v_link.project_id
     and d.company_id = v_link.company_id
     and d.revoked_at is null and not d.is_draft
     and (d.sent_at is not null or d.acknowledged_at is not null);
end;
$$;
revoke all on function client_portal_terms(text, uuid) from public, anon, authenticated;
grant execute on function client_portal_terms(text, uuid) to service_role;

-- The client says "looks great" or "please change". The project's owner and
-- the studio's managers are told. Returns false when the link, the
-- deliverable or the feedback switch does not allow it, and caps a link at
-- 30 notes a day so a leaked link cannot flood the studio.
create or replace function client_portal_leave_feedback(
  p_raw text, p_deliverable uuid, p_kind text, p_message text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_link client_portal_links;
  v_title text;
  v_project text;
  v_owner uuid;
  v_client text;
  v_id uuid;
  v_msg text := nullif(left(trim(coalesce(p_message, '')), 2000), '');
  r uuid;
begin
  if p_kind not in ('approved', 'change_requested') then
    return false;
  end if;
  if p_kind = 'change_requested' and v_msg is null then
    return false;
  end if;
  v_link := client_portal_link_for_token(p_raw);
  if v_link.id is null or not v_link.allow_feedback then
    return false;
  end if;

  select d.title, p.name, p.created_by, cl.name into v_title, v_project, v_owner, v_client
    from deliverables d
    join projects p on p.id = d.project_id and p.company_id = d.company_id
    left join clients cl on cl.id = p.client_id and cl.company_id = p.company_id
   where d.id = p_deliverable
     and d.project_id = v_link.project_id and d.company_id = v_link.company_id
     and d.visibility_scope = 'client' and coalesce(d.show_on_quotation, true)
     and d.status <> 'cancelled';
  if v_title is null then
    return false;
  end if;

  if (select count(*) from client_portal_feedback f
       where f.link_id = v_link.id and f.created_at > now() - interval '1 day') >= 30 then
    return false;
  end if;

  insert into client_portal_feedback (company_id, project_id, link_id, deliverable_id, kind, message)
  values (v_link.company_id, v_link.project_id, v_link.id, p_deliverable, p_kind, v_msg)
  returning id into v_id;

  for r in
    select distinct x from (
      select v_owner as x
       where v_owner is not null and exists (
         select 1 from users u where u.user_id = v_owner and u.company_id = v_link.company_id
            and u.deleted_at is null and u.status = 'active')
      union
      select notification_admin_recipients(v_link.company_id)
    ) s where x is not null
  loop
    perform create_notification(
      v_link.company_id, r, 'client_portal.feedback',
      case when p_kind = 'approved'
           then coalesce(v_client, 'The client') || ' loved ' || v_title
           else coalesce(v_client, 'The client') || ' asked for a change to ' || v_title end,
      coalesce(v_msg, v_project),
      'portal_feedback:' || v_id, 'project', v_link.project_id,
      case when p_kind = 'approved' then 'info' else 'warning' end,
      '/projects/' || v_link.project_id || '?tab=deliverables',
      jsonb_build_object('deliverable_id', p_deliverable, 'kind', p_kind));
  end loop;
  return true;
end;
$$;
revoke all on function client_portal_leave_feedback(text, uuid, text, text) from public, anon, authenticated;
grant execute on function client_portal_leave_feedback(text, uuid, text, text) to service_role;
