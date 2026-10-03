-- 0243: a client's birthdays and anniversary (client_occasions), the
-- wedding day filling the anniversary by itself, for the project's Wishes tab.
--
-- A client may have several dates: both partners' birthdays, the couple's
-- anniversary, a child's birthday. The year is optional (people often share
-- the day but not the year); with it, a wish can say "1st anniversary".
-- The wedding fills the anniversary by itself: a shoot named Wedding sets the
-- project's client's anniversary unless the studio or the client already
-- set one, and a moved wedding day moves it -- never one somebody typed.

create table if not exists client_occasions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  client_id   uuid not null references clients (id) on delete cascade,
  project_id  uuid references projects (id) on delete set null,
  kind        text not null check (kind in ('birthday', 'anniversary')),
  -- Whose day: "Priya", "Rahul". Blank for the couple's anniversary.
  person_name text not null default '' check (char_length(person_name) <= 80),
  month       smallint not null check (month between 1 and 12),
  day         smallint not null check (day between 1 and 31),
  year        smallint check (year is null or year between 1900 and 2100),
  -- Wish on this day (automatic wishes and the Wishes tab's next wish).
  wish        boolean not null default true,
  source      text not null default 'studio' check (source in ('studio', 'client_form', 'wedding_day')),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- 31 Feb and friends never land.
  check (make_date(2000, month, day) is not null),
  unique (client_id, kind, person_name)
);
create index if not exists client_occasions_company_idx on client_occasions (company_id, month, day);
drop trigger if exists client_occasions_set_updated_at on client_occasions;
create trigger client_occasions_set_updated_at before update on client_occasions
  for each row execute function set_updated_at();

alter table client_occasions enable row level security;
drop policy if exists client_occasions_select on client_occasions;
create policy client_occasions_select on client_occasions for select to authenticated
  using (company_id = get_current_company_id());
drop policy if exists client_occasions_write on client_occasions;
create policy client_occasions_write on client_occasions for all to authenticated
  using (company_id = get_current_company_id() and is_current_user_active())
  with check (company_id = get_current_company_id() and is_current_user_active()
              and client_id in (select id from clients where company_id = get_current_company_id()));
grant select, insert, update, delete on client_occasions to authenticated;
grant select, insert, update, delete on client_occasions to service_role;

-- The next time a day comes round, on or after p_from. 29 Feb is kept on 28
-- Feb in a year without it.
create or replace function occasion_next(p_month int, p_day int, p_from date)
returns date
language sql
immutable
as $$
  with y as (select extract(year from p_from)::int as yr),
  d as (
    select case
      when p_month = 2 and p_day = 29 and not ((yr % 4 = 0 and yr % 100 <> 0) or yr % 400 = 0)
        then make_date(yr, 2, 28) else make_date(yr, p_month, p_day) end as this_year,
      case
      when p_month = 2 and p_day = 29 and not (((yr + 1) % 4 = 0 and (yr + 1) % 100 <> 0) or (yr + 1) % 400 = 0)
        then make_date(yr + 1, 2, 28) else make_date(yr + 1, p_month, p_day) end as next_year
    from y
  )
  select case when this_year >= p_from then this_year else next_year end from d
$$;
grant execute on function occasion_next(int, int, date) to authenticated, service_role;

-- ── the wedding day sets the anniversary ────────────────────────────
create or replace function shoots_wedding_anniversary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client uuid;
  v_found  client_occasions;
begin
  if new.shoot_date is null or new.status = 'cancelled' or new.name !~* 'wedding' then
    return new;
  end if;
  -- "Wedding day" wins over "Pre-wedding": only a name that is the wedding.
  if new.name ~* '(pre|post)[\s-]*wedding' then
    return new;
  end if;
  select client_id into v_client from projects where id = new.project_id;
  if v_client is null then
    return new;
  end if;
  select * into v_found from client_occasions
   where client_id = v_client and kind = 'anniversary' and person_name = '';
  if not found then
    insert into client_occasions (company_id, client_id, project_id, kind, month, day, year, source)
      values (new.company_id, v_client, new.project_id, 'anniversary',
              extract(month from new.shoot_date), extract(day from new.shoot_date),
              extract(year from new.shoot_date), 'wedding_day');
  elsif v_found.source = 'wedding_day' and v_found.project_id is not distinct from new.project_id then
    update client_occasions
       set month = extract(month from new.shoot_date), day = extract(day from new.shoot_date),
           year = extract(year from new.shoot_date)
     where id = v_found.id;
  end if;
  return new;
end;
$$;
drop trigger if exists shoots_wedding_anniversary on shoots;
create trigger shoots_wedding_anniversary after insert or update of name, shoot_date, status on shoots
  for each row execute function shoots_wedding_anniversary();

-- Studios with weddings already planned get their anniversaries now.
insert into client_occasions (company_id, client_id, project_id, kind, month, day, year, source)
select distinct on (p.client_id) s.company_id, p.client_id, s.project_id, 'anniversary',
       extract(month from s.shoot_date), extract(day from s.shoot_date), extract(year from s.shoot_date), 'wedding_day'
  from shoots s join projects p on p.id = s.project_id
 where p.client_id is not null and s.shoot_date is not null and s.status <> 'cancelled'
   and s.name ~* 'wedding' and s.name !~* '(pre|post)[\s-]*wedding'
 order by p.client_id, (s.name ~* 'wedding\s*day') desc, s.shoot_date desc
on conflict (client_id, kind, person_name) do nothing;
