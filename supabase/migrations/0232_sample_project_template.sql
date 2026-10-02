-- 0232: Every studio starts with one sample project template.
--
-- Settings → Project templates opened on "No templates yet", so a new studio's
-- first project started from nothing. Each studio now gets one sample --
-- "Sample — Wedding" with Haldi, Wedding and Reception, an album, a highlight
-- film and a full film -- which it edits to match its own work or deletes.
--
-- is_sample marks it so the screen can say so; editing it clears the mark.
-- A studio that deleted its sample never gets it back: the seed runs once for
-- each new studio (trigger, the 0217 pattern) and once now for studios with no
-- templates at all.

alter table project_templates add column if not exists is_sample boolean not null default false;

create or replace function seed_sample_project_template(p_company uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into project_templates (company_id, name, description, deliverables_json, shoots_json, tasks_json, is_sample)
  select p_company,
         'Sample — Wedding',
         'Edit this sample to match your studio: the functions you cover, what you deliver, and your tasks.',
         '[{"name":"Wedding album","description":"30 sheets","quantity":1},
           {"name":"Highlight film","description":"4 minutes","quantity":1},
           {"name":"Full film","description":null,"quantity":1},
           {"name":"Edited photos","description":"300 photos","quantity":1}]'::jsonb,
         '[{"name":"Haldi","kind":"haldi","duration_hours":4},
           {"name":"Wedding","kind":"wedding","duration_hours":8},
           {"name":"Reception","kind":"reception","duration_hours":5}]'::jsonb,
         '[{"title":"Send the quotation","priority":"high","sort_order":1},
           {"title":"Book the team for every function","priority":"high","sort_order":2},
           {"title":"Back up every card the day after","priority":"medium","sort_order":3}]'::jsonb,
         true
   where not exists (select 1 from project_templates t where t.company_id = p_company);
$$;
revoke all on function seed_sample_project_template(uuid) from public, anon, authenticated;

create or replace function companies_seed_sample_template()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_sample_project_template(new.id);
  return null;
end;
$$;
drop trigger if exists companies_seed_sample_template on companies;
create trigger companies_seed_sample_template after insert on companies
  for each row execute function companies_seed_sample_template();

-- Studios that already exist and have no template at all get the sample once.
select seed_sample_project_template(c.id) from companies c
 where not exists (select 1 from project_templates t where t.company_id = c.id);
