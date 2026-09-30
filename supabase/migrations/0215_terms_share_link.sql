-- 0215: terms links the studio can share again, and emails it can see.
--
-- The owner sent terms from the Terms tab and the client never got them. Two
-- things in the database made that hard to put right:
--
--   * Only the hash of a link is stored (0010), so the studio could never
--     show the same link twice. "Share the link again" therefore had to mint
--     a new one -- which cancelled the link already in the client's inbox or
--     WhatsApp. Here the live link of each document is kept, readable only
--     through the functions below, so sharing again hands out the SAME link.
--   * The email log kept "sent" or "failed" and nothing else. Resend's
--     message id and the subject are now kept, so a studio (or we) can look a
--     send up in Resend and see whether it was delivered.
--
-- And a client whose link does not open is told why: agreed already,
-- replaced by a newer version, or past its date -- not one "invalid or
-- expired" for everything.

-- ── the live link of each document ───────────────────────────────
-- A table of its own, with RLS on and no policies: nothing reads it but the
-- security-definer functions here, which check the studio (and the API only
-- returns it to people who may edit the project).
create table if not exists terms_share_links (
  document_id uuid primary key references project_terms_documents (id) on delete cascade,
  company_id  uuid not null references companies (id) on delete cascade,
  token       text not null,
  created_at  timestamptz not null default now()
);
alter table terms_share_links enable row level security;
revoke all on terms_share_links from public, anon, authenticated;

-- ── what the email service answered ──────────────────────────────
alter table project_terms_email_logs
  add column if not exists provider_message_id text,
  add column if not exists subject text;

-- ── issue (latest body from 0163, plus: keep the link) ───────────
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
  insert into terms_share_links (document_id, company_id, token)
  values (v_doc, v_company, v_token)
  on conflict on constraint terms_share_links_pkey
  do update set token = excluded.token, created_at = now();

  -- The draft became this document.
  delete from project_terms_documents
   where company_id = v_company and project_id = p_project_id and is_draft;

  return query select v_doc, v_token;
end;
$$;

-- ── a fresh link for the same document (latest body from 0163) ───
-- Now only for a link that has run out: sharing a live link again reuses it.
create or replace function terms_document_new_link(p_doc uuid, p_ttl_hours int default 336)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_d       project_terms_documents;
  v_token   text;
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
  v_token := rotate_access_token('terms_ack', p_doc, p_ttl_hours);
  insert into terms_share_links (document_id, company_id, token)
  values (p_doc, v_company, v_token)
  on conflict on constraint terms_share_links_pkey
  do update set token = excluded.token, created_at = now();
  return v_token;
end;
$$;

-- ── the link to share again, while it still works ────────────────
-- Null for a document from before 0215 (its link was never kept), and for one
-- whose link was cancelled, used or has run out.
create or replace function terms_live_share_token(p_doc uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.token
    from terms_share_links s
    join project_terms_documents d on d.id = s.document_id
    join access_tokens t on t.purpose = 'terms_ack' and t.subject_id = d.id
                        and t.token_hash = encode(sha256(convert_to(s.token, 'UTF8')), 'hex')
   where s.document_id = p_doc
     and d.company_id = get_current_company_id()
     and is_current_user_active()
     and t.revoked_at is null and t.used_at is null
     and (t.expires_at is null or t.expires_at > now())
     and d.revoked_at is null and d.acknowledged_at is null
   limit 1
$$;

revoke all on function terms_live_share_token(uuid) from public, anon;
grant execute on function terms_live_share_token(uuid) to authenticated;

-- ── every version for one project, with its link and last email ──
drop function if exists list_project_terms(uuid);
create function list_project_terms(p_project_id uuid)
returns table (
  id uuid, title text, created_at timestamptz, expires_at timestamptz,
  revoked_at timestamptz, acknowledged_at timestamptz, acknowledged_by_name text,
  acknowledged_by_email text, access_count int, link_live boolean, emailed_to text,
  share_token text,
  last_email_to text, last_email_status text, last_email_at timestamptz, last_email_error text
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
           order by l.created_at desc limit 1),
         terms_live_share_token(d.id),
         e.to_email, e.status, e.created_at, e.error
    from project_terms_documents d
    left join lateral (
      select l.to_email, l.status, l.created_at, l.error
        from project_terms_email_logs l
       where l.document_id = d.id
       order by l.created_at desc
       limit 1
    ) e on true
   where d.project_id = p_project_id
     and d.company_id = get_current_company_id()
     and not d.is_draft
   order by d.created_at desc
$$;

revoke all on function list_project_terms(uuid) from public, anon;
grant execute on function list_project_terms(uuid) to authenticated;

-- ── why a client's link does not open ────────────────────────────
-- For the public page: the payload reader returns nothing for a link it will
-- not open, and the client deserves to know which of these it was.
create or replace function terms_link_state(p_raw text)
returns table (state text, expires_at timestamptz, acknowledged_at timestamptz, company_name text)
language sql
stable
security definer
set search_path = public
as $$
  select case
           when d.acknowledged_at is not null then 'agreed'
           when t.revoked_at is not null or d.revoked_at is not null then 'cancelled'
           when (t.expires_at is not null and t.expires_at <= now())
             or (d.expires_at is not null and d.expires_at <= now()) then 'expired'
           when t.used_at is not null then 'cancelled'
           else 'ok'
         end,
         coalesce(d.expires_at, t.expires_at),
         d.acknowledged_at,
         coalesce(co.display_name, co.name)
    from access_tokens t
    join project_terms_documents d on d.id = t.subject_id
    left join companies co on co.id = d.company_id
   where t.purpose = 'terms_ack'
     and t.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
   limit 1
$$;

revoke all on function terms_link_state(text) from public, anon, authenticated;
grant execute on function terms_link_state(text) to service_role;

-- ── who to tell when a client agrees ─────────────────────────────
-- The public ack runs as the service; this gives it the owner's address and
-- the names for the email, and nothing else.
create or replace function terms_agreed_notice(p_raw text)
returns table (owner_email text, company_id uuid, project_id uuid, project_name text, client_name text, agreed_by text, agreed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select u.email, d.company_id, d.project_id, p.name, cl.name, d.acknowledged_by_name, d.acknowledged_at
    from access_tokens t
    join project_terms_documents d on d.id = t.subject_id
    join companies co on co.id = d.company_id
    left join users u on u.user_id = co.owner_user_id and u.company_id = co.id
    left join projects p on p.id = d.project_id
    left join clients cl on cl.id = p.client_id
   where t.purpose = 'terms_ack'
     and t.token_hash = encode(sha256(convert_to(p_raw, 'UTF8')), 'hex')
     and d.acknowledged_at is not null
   limit 1
$$;

revoke all on function terms_agreed_notice(text) from public, anon, authenticated;
grant execute on function terms_agreed_notice(text) to service_role;
