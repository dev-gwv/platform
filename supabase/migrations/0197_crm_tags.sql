-- Tags on a lead, replacing one free-text box that no filter could reach.
--
-- 0080 gave crm_leads a `group_name` text column, labelled "Group / tag" in the
-- drawer. One value per lead, no colour, no list to pick from, and the server's
-- own ?group= filter was never wired to anything -- so a studio could type
-- "Referral - Sharma" on forty leads and had no way to ask for those forty back.
--
-- Tags proper: many per lead, a shared list per studio, and a colour taken from
-- the six theme hues rather than a hex code, because StatusBadge is a locked
-- primitive and a tag is a status chip like any other. Six is also enough --
-- past that nobody can tell the colours apart on a row.
--
-- group_name is deliberately left on the table and still readable. Everything
-- in it is copied into tags below, the UI stops writing it, and dropping the
-- column is a later migration once nothing reads it. Another session works this
-- repo daily; pulling a column out from under it is not worth the tidiness.

create table if not exists crm_tags (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 40),
  color      text not null default 'blue'
             check (color in ('blue', 'green', 'violet', 'amber', 'rose', 'teal')),
  -- Retired rather than deleted, so a tag can be taken out of the picker
  -- without silently un-tagging the leads that carry it.
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "Referral" and "referral" are the same tag. Case-insensitive and
-- whitespace-insensitive, per studio.
create unique index if not exists crm_tags_company_name_idx
  on crm_tags (company_id, lower(trim(name)));

create table if not exists crm_lead_tags (
  lead_id    uuid not null references crm_leads (id) on delete cascade,
  tag_id     uuid not null references crm_tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  primary key (lead_id, tag_id)
);

-- "which leads carry this tag" is the filter; without this it is a sequential
-- scan of every tag row the studio has.
create index if not exists crm_lead_tags_tag_idx on crm_lead_tags (tag_id);

drop trigger if exists crm_tags_set_updated_at on crm_tags;
create trigger crm_tags_set_updated_at before update on crm_tags
  for each row execute function set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────
alter table crm_tags      enable row level security;
alter table crm_lead_tags enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'crm_tags_select') then
    create policy crm_tags_select on crm_tags
      for select to authenticated using (company_id = get_current_company_id());
  end if;
  if not exists (select 1 from pg_policies where policyname = 'crm_tags_write') then
    create policy crm_tags_write on crm_tags
      for all to authenticated
      using (company_id = get_current_company_id() and is_current_user_active())
      with check (company_id = get_current_company_id() and is_current_user_active());
  end if;

  -- The join table carries no company_id of its own; the lead it points at is
  -- the tenant boundary. Without a matching policy Postgres denies, which for a
  -- join table means tags that exist and cannot be seen.
  if not exists (select 1 from pg_policies where policyname = 'crm_lead_tags_select') then
    create policy crm_lead_tags_select on crm_lead_tags
      for select to authenticated
      using (exists (select 1 from crm_leads l
                      where l.id = lead_id and l.company_id = get_current_company_id()));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'crm_lead_tags_write') then
    create policy crm_lead_tags_write on crm_lead_tags
      for all to authenticated
      using (exists (select 1 from crm_leads l
                      where l.id = lead_id and l.company_id = get_current_company_id())
             and is_current_user_active())
      with check (exists (select 1 from crm_leads l
                           where l.id = lead_id and l.company_id = get_current_company_id())
                  and is_current_user_active());
  end if;
end $$;

-- ── everything already in group_name becomes a tag ────────────
-- Colour is spread round the six hues by name, so a studio opening the screen
-- for the first time sees a spread rather than forty identical blue chips.
do $$
declare
  v_hues text[] := array['blue', 'green', 'violet', 'amber', 'rose', 'teal'];
begin
  insert into crm_tags (company_id, name, color)
  select l.company_id,
         trim(l.group_name),
         v_hues[1 + (abs(hashtext(lower(trim(l.group_name)))) % 6)]
    from crm_leads l
   where l.group_name is not null and btrim(l.group_name) <> ''
   group by l.company_id, trim(l.group_name)
  on conflict do nothing;

  insert into crm_lead_tags (lead_id, tag_id)
  select l.id, t.id
    from crm_leads l
    join crm_tags t
      on t.company_id = l.company_id
     and lower(trim(t.name)) = lower(trim(l.group_name))
   where l.group_name is not null and btrim(l.group_name) <> ''
  on conflict do nothing;
end $$;

-- ── attach or detach one tag across many leads ────────────────
-- The bulk toolbar needs this. It is deliberately not folded into
-- crm_bulk_patch: that function snapshots a column per lead so the undo toast
-- can put it back, and a set of rows in a join table is not a column value.
create or replace function crm_tag_leads(p_ids uuid[], p_tag uuid, p_attach boolean default true)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid := get_current_company_id();
  v_n       int  := 0;
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;
  if array_length(p_ids, 1) > 2000 then
    raise exception 'too many leads at once' using errcode = '22023';
  end if;

  -- The tag must belong to this studio, or a guessed id would let one company
  -- label another's leads.
  if not exists (select 1 from crm_tags t where t.id = p_tag and t.company_id = v_company) then
    raise exception 'unknown tag' using errcode = '42501';
  end if;

  if p_attach then
    insert into crm_lead_tags (lead_id, tag_id, created_by)
    select l.id, p_tag, auth.uid()
      from crm_leads l
     where l.id = any (p_ids) and l.company_id = v_company
    on conflict (lead_id, tag_id) do nothing;
    get diagnostics v_n = row_count;
  else
    delete from crm_lead_tags lt
     using crm_leads l
     where lt.lead_id = l.id
       and l.company_id = v_company
       and lt.lead_id = any (p_ids)
       and lt.tag_id = p_tag;
    get diagnostics v_n = row_count;
  end if;

  return v_n;
end;
$$;

-- ── the whole tag set for one lead, in one call ───────────────
-- The drawer's picker sends the list it wants rather than a diff, so a click
-- that adds one tag and a click that removes another are the same request.
create or replace function crm_set_lead_tags(p_lead uuid, p_tag_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid   := get_current_company_id();
  v_ids     uuid[] := coalesce(p_tag_ids, array[]::uuid[]);
begin
  if v_company is null or not is_current_user_active() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from crm_leads l where l.id = p_lead and l.company_id = v_company) then
    raise exception 'unknown lead' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(v_ids) as x(id)
     where not exists (select 1 from crm_tags t where t.id = x.id and t.company_id = v_company)
  ) then
    raise exception 'unknown tag' using errcode = '42501';
  end if;

  delete from crm_lead_tags where lead_id = p_lead and not (tag_id = any (v_ids));
  insert into crm_lead_tags (lead_id, tag_id, created_by)
  select p_lead, x.id, auth.uid() from unnest(v_ids) as x(id)
  on conflict (lead_id, tag_id) do nothing;
end;
$$;

revoke all on function crm_tag_leads(uuid[], uuid, boolean) from public, anon;
revoke all on function crm_set_lead_tags(uuid, uuid[]) from public, anon;
