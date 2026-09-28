-- 0204: each studio connects its own Facebook page for lead ads.
--
-- Until now one platform-wide page token (META_PAGE_ACCESS_TOKEN) fetched
-- every studio's leads, so only the studio that owned that token could use
-- Meta lead ads at all. Now a studio connects with Facebook (or pastes a
-- long-lived token), picks the pages that run its lead forms, and the API
-- keeps one page token per page -- encrypted like the WhatsApp one (0203,
-- WHATSAPP_TOKEN_KEY) and readable only by the service. Meta posts every
-- page's leads to the app's one webhook; the page id in the post finds the
-- studio here.

-- The page tokens. Never joined into fb_pages, which every signed-in user
-- of the studio can read.
create table if not exists fb_page_tokens (
  company_id   uuid not null references companies (id) on delete cascade,
  page_id      text not null,
  token_enc    text not null,
  fb_user_id   text,
  connected_by uuid,
  connected_at timestamptz not null default now(),
  primary key (company_id, page_id)
);
-- One page, one studio: Meta's post names the page, not the studio.
create unique index if not exists fb_page_tokens_page_uq on fb_page_tokens (page_id);
alter table fb_page_tokens enable row level security;
-- No policies: only the service reads it.
revoke all on fb_page_tokens from authenticated, anon;

alter table fb_pages
  add column if not exists connected_via text check (connected_via is null or connected_via in ('oauth', 'token')),
  add column if not exists subscribed_at timestamptz;

-- Which studio a page's leads belong to, and the source key to capture them
-- under. The studio's "Facebook lead ads" source is made on first use so the
-- import log and the lead's source label work without any setup.
create or replace function meta_page_company(p_page_id text)
returns table (company_id uuid, source_key text, page_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_name text;
  v_key text;
begin
  select p.company_id, p.page_name into v_company, v_name
    from fb_pages p
   where p.page_id = p_page_id and p.is_connected
   order by p.updated_at desc
   limit 1;
  if v_company is null then return; end if;

  select s.source_key into v_key
    from crm_webhook_sources s
   where s.company_id = v_company and s.kind = 'meta' and s.is_active
   order by s.created_at
   limit 1;
  if v_key is null then
    v_key := 'meta_' || replace(gen_random_uuid()::text, '-', '');
    insert into crm_webhook_sources (company_id, source_key, kind, label, source_type, default_source)
    values (v_company, v_key, 'meta', 'Facebook lead ads', 'webhook', 'facebook');
  end if;

  return query select v_company, v_key, v_name;
end;
$$;
revoke all on function meta_page_company(text) from public, anon, authenticated;
grant execute on function meta_page_company(text) to service_role;
