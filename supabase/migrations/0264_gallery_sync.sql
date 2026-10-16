-- 0264: Frameline gallery sync.
--
-- 0261 kept a project's gallery link and PIN once, when the gallery was made,
-- so a PIN changed in Frameline left the Gallery tab and the client's page
-- showing the old one. Now project_galleries keeps what Frameline last said
-- about the gallery, refreshed whenever the Gallery tab is read and whenever
-- Frameline sends its gallery-changed notice (POST /webhooks/frameline):
-- the PIN, the full-access PIN for the couple and family, the photo count,
-- visits, guests and when the gallery expires.
--
-- photos_announced is the photo count the studio was last told about in the
-- bell ("23 photos are in Priya & Rahul's gallery"), so each new batch rings
-- once and a re-read never rings again.
--
-- Frameline stays the source of truth for all of it; these are a cache.

alter table project_galleries
  add column if not exists full_access_pin  text check (full_access_pin is null or full_access_pin ~ '^[0-9]{4,8}$'),
  add column if not exists photo_count      integer not null default 0 check (photo_count >= 0),
  add column if not exists status           text check (status is null or char_length(status) <= 32),
  add column if not exists visits           integer not null default 0 check (visits >= 0),
  add column if not exists guests           integer check (guests is null or guests >= 0),
  add column if not exists expires_at       timestamptz,
  add column if not exists synced_at        timestamptz,
  add column if not exists photos_announced integer not null default 0 check (photos_announced >= 0);

-- The client's tracking page: the address, the PIN and, when the studio set
-- one, the full-access PIN -- the client is the couple, who see every photo.
-- Same signature as 0261, so a plain replace.
create or replace function client_portal_gallery(p_raw text)
returns jsonb
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
    return null;
  end if;
  return (
    select jsonb_build_object('url', g.gallery_url, 'pin', g.pin, 'full_access_pin', g.full_access_pin)
      from project_galleries g
     where g.project_id = v_link.project_id and g.company_id = v_link.company_id
  );
end;
$$;
revoke all on function client_portal_gallery(text) from public, anon, authenticated;
grant execute on function client_portal_gallery(text) to service_role;
