-- 0235: what the client did, for the project's Overview.
--
-- client_document_views keeps one row each time a client opens a quotation,
-- an invoice or a terms link -- at most one per document every ten minutes,
-- so a refresh is not a second visit. record_client_view() is called by the
-- API beside the public read, never before it: a failed insert must never
-- stop the client seeing the page. Studio staff opening their own link (the
-- API passes the signed-in viewer, if any) are not counted, and "See it as
-- the client" never reaches the public read at all.
--
-- Read only through client_activity(project): the studio's own projects,
-- newest first, a few lines.

create table if not exists client_document_views (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  project_id  uuid references projects (id) on delete cascade,
  kind        text not null check (kind in ('quotation', 'invoice', 'terms')),
  subject_id  uuid not null,
  viewed_at   timestamptz not null default now()
);
create index if not exists client_document_views_project_idx
  on client_document_views (project_id, viewed_at desc);
create index if not exists client_document_views_subject_idx
  on client_document_views (kind, subject_id, viewed_at desc);

alter table client_document_views enable row level security;
-- No policies: the service writes, client_activity() reads.
revoke all on client_document_views from public, anon, authenticated;

create or replace function record_client_view(p_kind text, p_raw text, p_viewer uuid default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_hash    text := encode(sha256(convert_to(coalesce(p_raw, ''), 'UTF8')), 'hex');
  v_purpose text := case p_kind when 'terms' then 'terms_ack' else p_kind end;
  v_subject uuid;
  v_company uuid;
  v_project uuid;
begin
  if p_kind not in ('quotation', 'invoice', 'terms') then
    return false;
  end if;

  select at.subject_id, at.company_id into v_subject, v_company
    from access_tokens at
   where at.purpose = v_purpose and at.token_hash = v_hash
   limit 1;
  if v_subject is null then
    return false;
  end if;

  -- Someone from the studio itself is not the client.
  if p_viewer is not null and exists (
    select 1 from users u where u.user_id = p_viewer and u.company_id = v_company
  ) then
    return false;
  end if;

  -- A refresh is not a second visit.
  if exists (
    select 1 from client_document_views v
     where v.kind = p_kind and v.subject_id = v_subject
       and v.viewed_at > now() - interval '10 minutes'
  ) then
    return false;
  end if;

  v_project := case p_kind
    when 'quotation' then (select q.project_id from project_quotations q where q.id = v_subject)
    when 'invoice'   then (select i.project_id from invoices i where i.id = v_subject)
    else (select d.project_id from project_terms_documents d where d.id = v_subject)
  end;

  insert into client_document_views (company_id, project_id, kind, subject_id)
  values (v_company, v_project, p_kind, v_subject);
  return true;
end;
$$;
revoke all on function record_client_view(text, text, uuid) from public, anon, authenticated;
grant execute on function record_client_view(text, text, uuid) to service_role;

-- One line per document the client opened on this project: when they last
-- opened it and how many times, newest first.
create or replace function client_activity(p_project uuid)
returns table (kind text, subject_id uuid, last_viewed_at timestamptz, views int)
language sql
stable
security definer
set search_path = public
as $$
  select v.kind, v.subject_id, max(v.viewed_at), count(*)::int
    from client_document_views v
    join projects p on p.id = v.project_id
   where v.project_id = p_project
     and p.company_id = get_current_company_id()
   group by v.kind, v.subject_id
   order by max(v.viewed_at) desc
   limit 5
$$;
revoke all on function client_activity(uuid) from public, anon;
grant execute on function client_activity(uuid) to authenticated;
