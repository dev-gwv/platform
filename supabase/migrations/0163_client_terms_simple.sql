-- Client terms: one clear document per project, links that behave.
--
-- The Terms tab could issue a document and hand out a link, and then lost
-- track of both: the link existed only in the browser that made it, there
-- was no way to send it again, "revoke" set a flag the client page ignored
-- (the page fell back to a reader that checked only the token), a second
-- document left the first one's link live, and nobody was told when the
-- client agreed. This makes the lifecycle what the screen says it is:
--
--   issue_client_terms      one call: the document with all its parts, its
--                           link, and every older unagreed version of this
--                           project's terms withdrawn (link and all).
--   terms_document_new_link a fresh link for the same document, the old one
--                           cancelled -- "send again" without a new document.
--   list_project_terms      every version for one project, newest first,
--                           with whether its link still works.
--   acknowledge_terms       refuses a cancelled, expired, already-agreed or
--                           withdrawn document, and tells the studio.
--   get_terms_for_token     (the old reader) honours cancelled links too.
--   get_terms_payload_*     now carry the payment table and legal note, and
--                           an agreed document can still be re-read.

-- ── issue ────────────────────────────────────────────────────────
create or replace function issue_client_terms(
  p_project_id    uuid,
  p_body          text,
  p_title         text default null,
  p_payment_terms jsonb default null,
  p_total_cost    numeric default null,
  p_legal_note    text default null,
  p_ttl_hours     int default 336,
  p_template_id   uuid default null
)
returns table (document_id uuid, token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_doc     uuid;
  v_token   text;
  v_old     record;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from projects where id = p_project_id and company_id = v_company) then
    raise exception 'That project is not in this studio.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'The terms are empty.' using errcode = '22023';
  end if;

  -- A new version replaces the old one: its link stops working, so a client
  -- can never agree to terms the studio has since changed. Agreed versions
  -- are the record of what was agreed and are left alone.
  for v_old in
    select id from project_terms_documents
     where company_id = v_company and project_id = p_project_id
       and not is_draft and acknowledged_at is null and revoked_at is null
  loop
    update project_terms_documents set revoked_at = now() where id = v_old.id;
    update access_tokens set revoked_at = now()
     where purpose = 'terms_ack' and subject_id = v_old.id and revoked_at is null;
  end loop;

  insert into project_terms_documents
    (company_id, project_id, template_id, rendered_body, title, payment_terms,
     total_cost, legal_note, expires_at)
  values
    (v_company, p_project_id, p_template_id, p_body, nullif(btrim(p_title), ''),
     coalesce(p_payment_terms, '[]'::jsonb), p_total_cost, nullif(btrim(p_legal_note), ''),
     case when p_ttl_hours is null then null else now() + make_interval(hours => p_ttl_hours) end)
  returning id into v_doc;

  v_token := issue_access_token('terms_ack', v_doc, p_ttl_hours);

  -- The draft became this document.
  delete from project_terms_documents
   where company_id = v_company and project_id = p_project_id and is_draft;

  return query select v_doc, v_token;
end;
$$;

revoke all on function issue_client_terms(uuid, text, text, jsonb, numeric, text, int, uuid) from public, anon;
grant execute on function issue_client_terms(uuid, text, text, jsonb, numeric, text, int, uuid) to authenticated;

-- ── a fresh link for the same document ───────────────────────────
create or replace function terms_document_new_link(p_doc uuid, p_ttl_hours int default 336)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_d       project_terms_documents;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_d from project_terms_documents where id = p_doc and company_id = v_company;
  if v_d.id is null or v_d.is_draft then
    raise exception 'That document was not found.' using errcode = 'P0001';
  end if;
  if v_d.acknowledged_at is not null then
    raise exception 'The client has already agreed to this.' using errcode = '22023';
  end if;
  if v_d.revoked_at is not null then
    raise exception 'This version was replaced or cancelled. Send a new version instead.' using errcode = '22023';
  end if;
  update project_terms_documents
     set expires_at = case when p_ttl_hours is null then null else now() + make_interval(hours => p_ttl_hours) end
   where id = p_doc;
  return rotate_access_token('terms_ack', p_doc, p_ttl_hours);
end;
$$;

revoke all on function terms_document_new_link(uuid, int) from public, anon;
grant execute on function terms_document_new_link(uuid, int) to authenticated;

-- ── cancel a link ────────────────────────────────────────────────
create or replace function cancel_terms_document(p_doc uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_company uuid := get_current_company_id();
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update project_terms_documents set revoked_at = coalesce(revoked_at, now())
   where id = p_doc and company_id = v_company and acknowledged_at is null and not is_draft;
  if not found then
    return false;
  end if;
  update access_tokens set revoked_at = now()
   where purpose = 'terms_ack' and subject_id = p_doc and company_id = v_company and revoked_at is null;
  return true;
end;
$$;

revoke all on function cancel_terms_document(uuid) from public, anon;
grant execute on function cancel_terms_document(uuid) to authenticated;

-- ── every version for one project ────────────────────────────────
create or replace function list_project_terms(p_project_id uuid)
returns table (
  id uuid, title text, created_at timestamptz, expires_at timestamptz,
  revoked_at timestamptz, acknowledged_at timestamptz, acknowledged_by_name text,
  acknowledged_by_email text, access_count int, link_live boolean, emailed_to text
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.title, d.created_at, d.expires_at, d.revoked_at, d.acknowledged_at,
         d.acknowledged_by_name, d.acknowledged_by_email, coalesce(d.access_count, 0),
         exists (
           select 1 from access_tokens t
            where t.purpose = 'terms_ack' and t.subject_id = d.id
              and t.revoked_at is null and t.used_at is null
              and (t.expires_at is null or t.expires_at > now())
         ),
         (select l.to_email from project_terms_email_logs l
           where l.document_id = d.id and l.status = 'sent'
           order by l.created_at desc limit 1)
    from project_terms_documents d
   where d.project_id = p_project_id
     and d.company_id = get_current_company_id()
     and not d.is_draft
   order by d.created_at desc
$$;

revoke all on function list_project_terms(uuid) from public, anon;
grant execute on function list_project_terms(uuid) to authenticated;

-- ── agree ────────────────────────────────────────────────────────
create or replace function acknowledge_terms(
  p_raw        text,
  p_name       text,
  p_email      text default null,
  p_ip         text default null,
  p_user_agent text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash    text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_token   uuid;
  v_doc     uuid;
  v_d       project_terms_documents;
  v_project text;
  v_who     uuid;
begin
  select t.id, d.id into v_token, v_doc
    from access_tokens t
    join project_terms_documents d on d.id = t.subject_id
   where t.purpose = 'terms_ack' and t.token_hash = v_hash
     and t.used_at is null and t.revoked_at is null
     and (t.expires_at is null or t.expires_at > now())
     and d.revoked_at is null and d.acknowledged_at is null and not d.is_draft
     and (d.expires_at is null or d.expires_at > now())
   for update of t;
  if v_token is null then
    return false;   -- invalid, cancelled, expired, replaced, or already agreed
  end if;
  select * into v_d from project_terms_documents where id = v_doc;

  update access_tokens set used_at = now() where id = v_token;
  update project_terms_documents
     set acknowledged_at = now(), acknowledged_by_name = p_name,
         acknowledged_by_email = p_email, acknowledged_ip = p_ip,
         acknowledged_user_agent = p_user_agent
   where id = v_d.id;

  -- Tell the studio: the owner, and whoever created the project.
  select name into v_project from projects where id = v_d.project_id;
  for v_who in
    select distinct u from (
      select owner_user_id as u from companies where id = v_d.company_id
      union
      select created_by from projects where id = v_d.project_id
    ) w
    where u is not null and exists (select 1 from users where user_id = u and company_id = v_d.company_id)
  loop
    perform create_notification(
      v_d.company_id, v_who, 'terms_agreed',
      p_name || ' agreed to the terms',
      coalesce(v_project, ''),
      'terms_agreed:' || v_d.id || ':' || v_who,
      'project', v_d.project_id, 'info',
      case when v_d.project_id is null then '/project-documents'
           else '/projects/' || v_d.project_id || '?tab=terms' end);
  end loop;
  return true;
end;
$$;

-- ── the old body-only reader honours cancelled links ─────────────
create or replace function get_terms_for_token(p_raw text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select d.rendered_body
    from access_tokens t
    join project_terms_documents d on d.id = t.subject_id
   where t.purpose = 'terms_ack'
     and t.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
     and t.revoked_at is null
     and d.revoked_at is null
     and (d.acknowledged_at is not null
          or ((t.expires_at is null or t.expires_at > now())
              and (d.expires_at is null or d.expires_at > now())))
   limit 1
$$;

-- ── the client's reader: an agreed document stays readable ───────
create or replace function get_terms_payload_for_token(p_raw text)
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
volatile
security definer
set search_path = public
as $$
declare
  v_hash text := encode(sha256(convert_to(p_raw, 'UTF8')), 'hex');
  v_doc uuid;
begin
  -- A cancelled link never opens. An agreed document can be re-read from its
  -- link after the link's date has passed: it is the client's copy.
  select t.subject_id into v_doc
    from access_tokens t
    join project_terms_documents d on d.id = t.subject_id
   where t.purpose = 'terms_ack'
     and t.token_hash = v_hash
     and t.revoked_at is null
     and d.revoked_at is null
     and (d.acknowledged_at is not null
          or ((t.expires_at is null or t.expires_at > now())
              and (d.expires_at is null or d.expires_at > now())))
   limit 1;
  if v_doc is null then
    return;
  end if;

  update access_tokens at set access_count = coalesce(at.access_count, 0) + 1
   where at.purpose = 'terms_ack' and at.token_hash = v_hash;
  update project_terms_documents d set access_count = coalesce(d.access_count, 0) + 1
   where d.id = v_doc;

  return query
  select d.title, d.rendered_body, p.name, cl.name, cl.phone,
         coalesce(co.display_name, co.name),
         coalesce(co.invoice_logo_url, co.avatar_url),
         co.invoice_phone, co.invoice_email, co.invoice_address,
         d.payment_summary, coalesce(d.sections, '[]'::jsonb), d.expires_at,
         (d.revoked_at is not null),
         d.acknowledged_at, d.acknowledged_by_name, coalesce(d.access_count, 0),
         co.legal_name, co.website, co.document_footer_note,
         cl.email, cl.address, co.invoice_gst_number,
         'T-' || upper(substring(d.id::text, 1, 8)), d.created_at,
         coalesce(d.payment_terms, '[]'::jsonb),
         coalesce(d.total_cost, p.total_cost),
         d.legal_note
    from project_terms_documents d
    left join projects p on p.id = d.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = d.company_id
   where d.id = v_doc;
end;
$$;

-- ── the studio's reader: now with the payment table and legal note ──
drop function if exists get_terms_payload_for_document(uuid);
create function get_terms_payload_for_document(p_doc uuid)
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
  v_company uuid := get_current_company_id();
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  select d.title, d.rendered_body, p.name, cl.name, cl.phone,
         coalesce(co.display_name, co.name),
         coalesce(co.invoice_logo_url, co.avatar_url),
         co.invoice_phone, co.invoice_email, co.invoice_address,
         d.payment_summary, coalesce(d.sections, '[]'::jsonb), d.expires_at,
         (d.revoked_at is not null),
         d.acknowledged_at, d.acknowledged_by_name, coalesce(d.access_count, 0),
         co.legal_name, co.website, co.document_footer_note,
         cl.email, cl.address, co.invoice_gst_number,
         'T-' || upper(substring(d.id::text, 1, 8)), d.created_at,
         coalesce(d.payment_terms, '[]'::jsonb),
         coalesce(d.total_cost, p.total_cost),
         d.legal_note
    from project_terms_documents d
    left join projects p on p.id = d.project_id
    left join clients cl on cl.id = p.client_id
    left join companies co on co.id = d.company_id
   where d.id = p_doc
     and d.company_id = v_company;
end;
$$;

revoke all on function get_terms_payload_for_document(uuid) from public, anon;
grant execute on function get_terms_payload_for_document(uuid) to authenticated;

-- ── templates can be removed ─────────────────────────────────────
-- (A plain delete under RLS; nothing to add here but a note that the API
-- now offers it, so the list does not only ever grow.)

-- ── is this raw link the live link of this studio's document? ────
create or replace function terms_link_is_live(p_doc uuid, p_raw text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from access_tokens t
      join project_terms_documents d on d.id = t.subject_id
     where t.purpose = 'terms_ack' and t.subject_id = p_doc
       and d.company_id = get_current_company_id()
       and t.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
       and t.revoked_at is null and t.used_at is null
       and (t.expires_at is null or t.expires_at > now())
       and d.revoked_at is null and d.acknowledged_at is null
  )
$$;

revoke all on function terms_link_is_live(uuid, text) from public, anon;
grant execute on function terms_link_is_live(uuid, text) to authenticated;
