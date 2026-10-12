-- 0261: a project's photo gallery in Frameline, the gallery add-on.
--
-- Frameline (the Kamero-style event gallery: albums, a PIN, guests finding
-- their own photos with a selfie) is its own app on Cloudflare and its own
-- paid add-on. Studio AutoPilot makes one gallery per project through
-- Frameline's integration API and keeps what it needs to show without asking
-- Frameline every time: the gallery's address and PIN, for the project's
-- Gallery tab and the client's tracking page.
--
-- Frameline holds the photos, the counts and the billing; nothing here is the
-- source of truth for any of those.

create table if not exists project_galleries (
  project_id  uuid primary key references projects (id) on delete cascade,
  company_id  uuid not null references companies (id) on delete cascade,
  -- Frameline's ids: the event, and its 7-character public code.
  event_id    text not null check (char_length(event_id) <= 128),
  short_id    text not null check (char_length(short_id) <= 32),
  gallery_url text not null check (gallery_url ~ '^https?://' and char_length(gallery_url) <= 500),
  pin         text check (pin is null or pin ~ '^[0-9]{4,8}$'),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists project_galleries_company_idx on project_galleries (company_id);
drop trigger if exists project_galleries_set_updated_at on project_galleries;
create trigger project_galleries_set_updated_at before update on project_galleries
  for each row execute function set_updated_at();

alter table project_galleries enable row level security;
drop policy if exists project_galleries_select on project_galleries;
create policy project_galleries_select on project_galleries for select to authenticated
  using (company_id = get_current_company_id());
drop policy if exists project_galleries_write on project_galleries;
create policy project_galleries_write on project_galleries for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active()
              and project_id in (select id from projects where company_id = get_current_company_id()));
grant select, insert, update, delete on project_galleries to authenticated;
grant select, insert, update, delete on project_galleries to service_role;

-- The gallery for the client's tracking page: its address and PIN, and
-- nothing else of the project. Read through the same link check as
-- get_client_portal (0252), so a stopped or expired link shows no gallery.
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
    select jsonb_build_object('url', g.gallery_url, 'pin', g.pin)
      from project_galleries g
     where g.project_id = v_link.project_id and g.company_id = v_link.company_id
  );
end;
$$;
revoke all on function client_portal_gallery(text) from public, anon, authenticated;
grant execute on function client_portal_gallery(text) to service_role;
