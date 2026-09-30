-- 0217: a record of every email the app tries to send, and what the email
-- service answered -- so "the mail did not arrive" can be answered from the
-- app instead of guessed at.
--
-- The owner signed up, sent terms to himself, and nothing came. Sign-up and
-- password emails went through a sender that only wrote a failure to the
-- server log; there was no way to tell "never sent" (no key, domain not
-- verified) from "sent but bounced / in spam". Every send now leaves a row:
-- who it was for, what kind, whether the service accepted it, its message id
-- (so delivery can be looked up with the service) and the refusal if any.
--
-- Service-only: rows carry email addresses of people outside the studio, so
-- no client role reads the table. The platform admin sees it through the API.

create table if not exists email_log (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid references companies (id) on delete set null,
  kind                text not null,                 -- 'verification', 'password_reset', 'client_doc', ...
  to_address          text not null,
  subject             text,
  status              text not null check (status in ('sent', 'failed', 'skipped')),
  provider_message_id text,
  error               text,
  created_at          timestamptz not null default now()
);

create index if not exists email_log_time_idx on email_log (created_at desc);
create index if not exists email_log_to_idx on email_log (lower(to_address), created_at desc);

alter table email_log enable row level security;
revoke all on email_log from public, anon, authenticated;
grant select, insert, delete on email_log to service_role;

-- ── Expense categories a studio actually spends on ─────────────
-- The owner opened Add expense and found nothing useful to pick: studios had
-- seven bare words (travel, food, supplies…) and none of what a photography
-- studio spends on. Each studio now gets a proper list -- skipped where the
-- studio already has the same word in any case, so nothing doubles up -- and
-- every new studio gets it through a trigger of its own (0154 explains why
-- seed_custom_lookups_for_company is left alone).
create or replace function seed_expense_categories(p_company uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into custom_lookups (company_id, category, value, sort_order, is_active, color)
  select p_company, 'expense_category', v.value, v.sort_order, true, v.color
    from (values
      ('Travel', 1, 'blue'), ('Fuel', 2, 'blue'), ('Food & meals', 3, 'amber'), ('Accommodation', 4, 'violet'),
      ('Equipment rental', 5, 'teal'), ('Freelancer fee', 6, 'green'), ('Album & printing', 7, 'rose'),
      ('Hard drives & storage', 8, 'slate'), ('Props & decor', 9, 'rose'), ('Venue & permits', 10, 'violet'),
      ('Marketing & ads', 11, 'amber'), ('Software & subscriptions', 12, 'teal'), ('Repairs & maintenance', 13, 'slate'),
      ('Office & rent', 14, 'slate'), ('Other', 15, 'slate')
    ) as v(value, sort_order, color)
   where not exists (
     select 1 from custom_lookups cl
      where cl.company_id = p_company and cl.category = 'expense_category' and lower(cl.value) = lower(v.value))
  on conflict (company_id, category, value) do nothing;
$$;
revoke all on function seed_expense_categories(uuid) from public, anon, authenticated;

-- The seven old defaults were bare lowercase words ('travel', 'food'…). Give
-- them their proper names first -- the studio's expenses (and personal
-- expenses) that carry the old word move with it, so no filter or report
-- loses a row -- and only where the new name is not already taken.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('travel', 'Travel'), ('food', 'Food & meals'), ('accommodation', 'Accommodation'),
      ('supplies', 'Supplies'), ('equipment', 'Equipment'), ('communication', 'Phone & internet'), ('other', 'Other')
    ) as v(old_value, new_value)
  loop
    update expenses e set category = r.new_value
     where e.category = r.old_value
       and exists (select 1 from custom_lookups cl where cl.company_id = e.company_id and cl.category = 'expense_category' and cl.value = r.old_value)
       and not exists (select 1 from custom_lookups cl where cl.company_id = e.company_id and cl.category = 'expense_category' and cl.value = r.new_value);
    update personal_expense pe set category = r.new_value
     where pe.category = r.old_value
       and exists (select 1 from custom_lookups cl where cl.company_id = pe.company_id and cl.category = 'expense_category' and cl.value = r.old_value)
       and not exists (select 1 from custom_lookups cl where cl.company_id = pe.company_id and cl.category = 'expense_category' and cl.value = r.new_value);
    update custom_lookups cl set value = r.new_value
     where cl.category = 'expense_category' and cl.value = r.old_value
       and not exists (select 1 from custom_lookups x where x.company_id = cl.company_id and x.category = 'expense_category' and x.value = r.new_value);
  end loop;
end $$;

select seed_expense_categories(c.id) from companies c;

-- One order for the list: the photography set first, anything else after.
update custom_lookups cl set sort_order = coalesce(o.pos, 100 + cl.sort_order)
  from (select cl2.id,
               array_position(array['Travel','Fuel','Food & meals','Accommodation','Equipment rental','Freelancer fee',
                 'Album & printing','Hard drives & storage','Props & decor','Venue & permits','Marketing & ads',
                 'Software & subscriptions','Repairs & maintenance','Office & rent','Equipment','Supplies','Phone & internet','Other'],
                 cl2.value) as pos
          from custom_lookups cl2 where cl2.category = 'expense_category') o
 where o.id = cl.id;

create or replace function companies_seed_expense_categories()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform seed_expense_categories(new.id);
  return null;
end;
$$;
drop trigger if exists companies_seed_expense_categories on companies;
create trigger companies_seed_expense_categories after insert on companies
  for each row execute function companies_seed_expense_categories();

-- ── The Diamond group link ────────────────────────────────────
-- The verify card asks for a screenshot of the IPC Diamonds - Premium group;
-- the owner wants it to also give a link, set from the platform console. One
-- row, readable by any signed-in studio (it is shown on their card), written
-- only by the API for a platform admin.
create table if not exists platform_settings (
  id                 boolean primary key default true check (id),
  diamond_group_link text check (diamond_group_link is null or diamond_group_link ~ '^https://'),
  updated_at         timestamptz not null default now()
);
insert into platform_settings (id) values (true) on conflict do nothing;
alter table platform_settings enable row level security;
drop policy if exists platform_settings_read on platform_settings;
create policy platform_settings_read on platform_settings for select to authenticated using (true);
revoke insert, update, delete on platform_settings from authenticated, anon;
grant select on platform_settings to authenticated;
grant select, update on platform_settings to service_role;
