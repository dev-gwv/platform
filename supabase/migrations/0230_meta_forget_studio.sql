-- 0230: "Disconnect Facebook" -- a studio forgets its whole Facebook
-- connection: every page token and every page it saw. Leads already
-- imported, the import log and the lead source stay.
--
-- The API unsubscribes each connected page from the leadgen webhook first
-- (best effort: a revoked token cannot), then calls this. Returns how many
-- pages were forgotten. Service-only: the tokens table is service-only too.

create or replace function meta_forget_studio(p_company uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pages int;
begin
  delete from fb_page_tokens where company_id = p_company;
  with gone as (delete from fb_pages where company_id = p_company returning 1)
  select count(*)::int into v_pages from gone;
  return v_pages;
end;
$$;
revoke all on function meta_forget_studio(uuid) from public, anon, authenticated;
grant execute on function meta_forget_studio(uuid) to service_role;
