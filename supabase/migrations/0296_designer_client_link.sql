-- 0296: Quotation Designer, step 2 (owner, 9 Nov: "complete the quotation maker
-- completely"): the client's link to a design and when they opened it.
--
-- One live link per design. The token is kept whole (service-only), the way
-- client_portal_link_tokens is (0252), so "Send to client" copies the same
-- link again instead of making a new one; "Stop sharing" deletes the row and
-- the old link is a plain 404 at once. Opens are counted here, one per ten
-- minutes, never the studio's own people (the API leaves them out).
-- Safe to run twice.

create table if not exists quotation_design_links (
  design_id      uuid primary key references quotation_designs (id) on delete cascade,
  token          text not null unique check (char_length(token) between 20 and 80),
  created_at     timestamptz not null default now(),
  views          int not null default 0,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz
);
alter table quotation_design_links enable row level security;
revoke all on quotation_design_links from public, anon, authenticated;
grant all on quotation_design_links to service_role;

-- A client's open, at most one per ten minutes (a refresh is not a visit).
create or replace function design_link_opened(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update quotation_design_links
     set views = views + 1,
         first_viewed_at = coalesce(first_viewed_at, now()),
         last_viewed_at = now()
   where token = p_token
     and (last_viewed_at is null or last_viewed_at < now() - interval '10 minutes');
$$;
revoke all on function design_link_opened(text) from public, anon, authenticated;
grant execute on function design_link_opened(text) to service_role;
