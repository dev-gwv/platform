-- 0297: Quotation Designer, step 3 (owner, 9 Nov: "everything that is there in Canva"):
-- the studio's own saved templates and its photo library.
--
-- A saved template is a design row marked is_template: it is listed under
-- Templates, starts new designs, and is never counted against Starter's 30
-- designs a year (the plan-limit trigger skips it, company_usage leaves it
-- out). The photo library is every photo the studio uploaded into a design,
-- kept so it can be dragged onto any frame later; removing one from the
-- library never touches a design that shows it. Safe to run twice.

alter table quotation_designs add column if not exists is_template boolean not null default false;
grant update (is_template) on quotation_designs to authenticated;

-- company_usage copied from 0295 with templates left out of 'designs'.
create or replace function company_usage(p_company uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with w as (select starts from plan_window(p_company))
  select jsonb_build_object(
    'projects', (select count(*) from projects, w where company_id = p_company and created_at >= w.starts),
    'invoices', (select count(*) from invoices, w where company_id = p_company and created_at >= w.starts),
    'leads', (select count(*) from crm_leads where company_id = p_company and not is_archived and merged_into is null),
    'team_logins', (select count(*) from users u join companies c on c.id = u.company_id
                     where u.company_id = p_company and u.login_enabled and u.status <> 'inactive'
                       and u.user_id is distinct from c.owner_user_id),
    'team_members', (select count(*) from users u join companies c on c.id = u.company_id
                      where u.company_id = p_company and not u.login_enabled and u.status <> 'inactive'
                        and u.user_id is distinct from c.owner_user_id),
    'enquiry_forms', (select count(*) from enquiry_forms where company_id = p_company and archived_at is null),
    'facebook_pages', (select count(*) from fb_pages where company_id = p_company and is_connected),
    'packages', (select count(*) from project_templates where company_id = p_company and not is_sample),
    -- 0295: quotation designs made in the plan year; 0297: a saved template is not a design.
    'designs', (select count(*) from quotation_designs, w where company_id = p_company and created_at >= w.starts and not is_template),
    'storage_mb', (select coalesce(ceil(sum(size_bytes) / 1048576.0), 0)::int from files where company_id = p_company)
  )
$$;

drop trigger if exists quotation_designs_plan_limit on quotation_designs;
create trigger quotation_designs_plan_limit
  before insert on quotation_designs
  for each row when (not new.is_template)
  execute function enforce_plan_limit('designs');

create table if not exists design_photos (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null default get_current_company_id() references companies (id) on delete cascade,
  url         text not null check (char_length(url) between 1 and 2000),
  name        text not null default '' check (char_length(name) <= 200),
  width       int,
  height      int,
  size_bytes  int,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists design_photos_company_idx on design_photos (company_id, created_at desc);
alter table design_photos enable row level security;
drop policy if exists design_photos_select on design_photos;
create policy design_photos_select on design_photos
  for select to authenticated using (company_id = get_current_company_id());
drop policy if exists design_photos_insert on design_photos;
create policy design_photos_insert on design_photos
  for insert to authenticated
  with check (company_id = get_current_company_id() and is_current_user_active());
drop policy if exists design_photos_delete on design_photos;
create policy design_photos_delete on design_photos
  for delete to authenticated
  using (company_id = get_current_company_id() and is_current_user_active());
grant select, insert, delete on design_photos to authenticated;
grant all on design_photos to service_role;
