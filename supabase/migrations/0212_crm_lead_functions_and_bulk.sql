-- 0212: a lead holds several functions -- Haldi, Mehendi, Wedding, Reception --
-- each with its own date and venue.
--
-- Until now crm_leads had one event_type, one event_date and one
-- event_location. A couple who asks for four functions had to be squeezed
-- into the first one, and the other three dates lived in a note nobody could
-- filter on. The owner: "they have multiple events. I should be able to select
-- that."
--
-- crm_lead_functions is the list. The three old columns stay and are kept
-- equal to the lead's FIRST function (earliest date, then the order they were
-- added), so everything that already reads them -- the date-availability check
-- (0193), filters, the morning email, reports, imports -- keeps working
-- without being touched.
--
-- Sync runs both ways, carefully:
--   * a function row changes  -> the lead's three columns follow (trigger on
--     crm_lead_functions);
--   * something writes the lead's columns directly (a web form, a Meta lead,
--     an import, an older client) -> that becomes the lead's function when it
--     has at most one, so nothing typed is lost; a lead with a real list of
--     several functions is left alone and re-syncs on the next list change.
-- pg_trigger_depth() stops each side from firing the other in a loop.

create table if not exists crm_lead_functions (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  lead_id    uuid not null references crm_leads (id) on delete cascade,
  -- Empty when only a date is known ("something on 12 Dec") -- the type is
  -- filled in later, never invented.
  event_type text check (event_type is null or char_length(trim(event_type)) between 1 and 80),
  event_date date,
  location   text check (location is null or char_length(location) <= 200),
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists crm_lead_functions_lead_idx on crm_lead_functions (lead_id, sort);
create index if not exists crm_lead_functions_company_date_idx
  on crm_lead_functions (company_id, event_date) where event_date is not null;

-- ── RLS: same shape as crm_tags ───────────────────────────────
alter table crm_lead_functions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'crm_lead_functions_select') then
    create policy crm_lead_functions_select on crm_lead_functions
      for select to authenticated using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'crm_lead_functions_write') then
    create policy crm_lead_functions_write on crm_lead_functions
      for all to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id() and is_current_user_active()
                  and exists (select 1 from crm_leads l
                               where l.id = lead_id and l.company_id = get_current_company_id()));
  end if;
end $$;

-- ── a function changed: the lead's three columns follow ───────
create or replace function crm_lead_functions_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead uuid := coalesce(new.lead_id, old.lead_id);
  v_first record;
begin
  select f.event_type, f.event_date, f.location into v_first
    from crm_lead_functions f
   where f.lead_id = v_lead
   order by f.event_date nulls last, f.sort, f.created_at
   limit 1;

  if found then
    update crm_leads l
       set event_type = v_first.event_type,
           event_date = v_first.event_date,
           event_location = v_first.location
     where l.id = v_lead
       and (l.event_type, l.event_date, l.event_location)
           is distinct from (v_first.event_type, v_first.event_date, v_first.location);
  else
    update crm_leads l
       set event_type = null, event_date = null, event_location = null
     where l.id = v_lead
       and (l.event_type is not null or l.event_date is not null or l.event_location is not null);
  end if;
  return null;
end;
$$;

drop trigger if exists crm_lead_functions_sync on crm_lead_functions;
create trigger crm_lead_functions_sync
  after insert or update or delete on crm_lead_functions
  for each row execute function crm_lead_functions_sync();

-- ── the lead's columns were written directly: keep the list in step ──
create or replace function crm_leads_functions_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- Written by crm_lead_functions_sync itself: the list is already right.
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and (new.event_type, new.event_date, new.event_location)
         is not distinct from (old.event_type, old.event_date, old.event_location) then
    return null;
  end if;

  select count(*) into v_count from crm_lead_functions where lead_id = new.id;
  if v_count > 1 then
    return null; -- a real list; one column write does not overwrite it
  end if;

  if nullif(trim(coalesce(new.event_type, '')), '') is null and new.event_date is null then
    delete from crm_lead_functions where lead_id = new.id;
  elsif v_count = 0 then
    insert into crm_lead_functions (company_id, lead_id, event_type, event_date, location)
    values (new.company_id, new.id, nullif(trim(coalesce(new.event_type, '')), ''),
            new.event_date, new.event_location);
  else
    update crm_lead_functions
       set event_type = nullif(trim(coalesce(new.event_type, '')), ''),
           event_date = new.event_date,
           location   = new.event_location
     where lead_id = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists crm_leads_functions_follow on crm_leads;
create trigger crm_leads_functions_follow
  after insert or update of event_type, event_date, event_location on crm_leads
  for each row execute function crm_leads_functions_follow();

-- ── backfill: every lead that already has an event gets it as its first function ──
insert into crm_lead_functions (company_id, lead_id, event_type, event_date, location)
select l.company_id, l.id, nullif(trim(coalesce(l.event_type, '')), ''),
       l.event_date, l.event_location
  from crm_leads l
 where (nullif(trim(coalesce(l.event_type, '')), '') is not null or l.event_date is not null)
   and not exists (select 1 from crm_lead_functions f where f.lead_id = l.id);
