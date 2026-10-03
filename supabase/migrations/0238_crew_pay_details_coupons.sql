-- 0238: close the unused coupons table to studios, and stop new studios
-- getting every expense category twice.
--
-- coupons (0001) is platform data that nothing in the app reads, yet its
-- policy let every signed-in user list the active codes and their discounts.
-- The table and its rows stay (nothing is deleted); only the service role,
-- which bypasses RLS, can read it now.
--
-- The studio entering a member's UPI or bank details needs no schema change:
-- PUT /team/members/:id/pay-to writes member_profiles as the service after
-- the same check as the read, audits field names only, and tells the person.

drop policy if exists coupons_select_active on coupons;
revoke all on coupons from anon, authenticated;

-- ── expense categories: one list, not two ─────────────────────────────
-- seed_custom_lookups_for_company() is copied from 0154 (the latest) without
-- its expense_category block: since 0217 seed_expense_categories() gives a
-- new studio the proper list, and both ran, so the picker read Travel and
-- travel, Accommodation and accommodation, Other and other.
create or replace function seed_custom_lookups_for_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into custom_lookups (company_id, category, value, sort_order, is_active)
  select new.id, 'lead_source', v.value, v.sort_order, true
  from (values ('manual',1),('facebook',2),('instagram',3),('whatsapp',4),('website',5),('google',6),('referral',7),('other',8)) as v(value, sort_order)
  on conflict (company_id, category, value) do nothing;

  -- Expense categories come from seed_expense_categories() (0217) alone; the
  -- old lowercase words seeded here gave every new studio Travel and travel.

  insert into custom_lookups (company_id, category, value, sort_order, is_active)
  select new.id, 'enquiry_source', v.value, v.sort_order, true
  from (values ('website',1),('phone',2),('walk_in',3),('instagram',4),('facebook',5),('referral',6),('other',7)) as v(value, sort_order)
  on conflict (company_id, category, value) do nothing;

  insert into custom_lookups (company_id, category, value, sort_order, is_active)
  select new.id, 'payment_type', v.value, v.sort_order, true
  from (values ('UPI',1),('Cash',2),('Bank transfer',3),('Cheque',4)) as v(value, sort_order)
  on conflict (company_id, category, value) do nothing;

  insert into custom_lookups (company_id, category, value, sort_order, is_active)
  select new.id, 'invoice_line_preset', v.value, v.sort_order, true
  from (values
    ('Wedding Photography Package',1),('Traditional Photography',2),('Candid Photography',3),
    ('Cinematography',4),('Drone Coverage',5),('Pre-Wedding Shoot',6),('Edited Photos',7),
    ('Wedding Film',8),('Highlight Film',9),('Photo Album',10),('Raw Data',11),
    ('Extra Event Coverage',12),('Travel Charges',13),('Same Day Edit',14)
  ) as v(value, sort_order)
  on conflict (company_id, category, value) do nothing;

  insert into custom_lookups (company_id, category, value, sort_order, is_active)
  select new.id, 'enquiry_status', v.value, v.sort_order, true
  from (values ('new',1),('reviewed',2),('contacted',3),('converted',4),('closed',5)) as v(value, sort_order)
  on conflict (company_id, category, value) do nothing;

  return new;
end;
$$;

-- Studios made since 0217 carry the old lowercase words beside the proper
-- ones. Expenses filed under a lowercase word move to its proper name (only
-- where that name exists), and the lowercase entry is switched off -- not
-- deleted, so nothing that names it is lost.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('travel', 'Travel'), ('food', 'Food & meals'), ('accommodation', 'Accommodation'), ('other', 'Other')
    ) as v(old_value, new_value)
  loop
    update expenses e set category = r.new_value
     where e.category = r.old_value
       and exists (select 1 from custom_lookups cl where cl.company_id = e.company_id and cl.category = 'expense_category' and cl.value = r.new_value);
    update personal_expense pe set category = r.new_value
     where pe.category = r.old_value
       and exists (select 1 from custom_lookups cl where cl.company_id = pe.company_id and cl.category = 'expense_category' and cl.value = r.new_value);
    update custom_lookups cl set is_active = false
     where cl.category = 'expense_category' and cl.value = r.old_value
       and exists (select 1 from custom_lookups x where x.company_id = cl.company_id and x.category = 'expense_category' and x.value = r.new_value);
  end loop;
  -- The words with no proper twin in the new list stay, switched off only
  -- where the studio has never filed an expense under them.
  update custom_lookups cl set is_active = false
   where cl.category = 'expense_category' and cl.value in ('supplies', 'equipment', 'communication')
     and exists (select 1 from custom_lookups x where x.company_id = cl.company_id and x.category = 'expense_category' and x.value = 'Travel')
     and not exists (select 1 from expenses e where e.company_id = cl.company_id and e.category = cl.value)
     and not exists (select 1 from personal_expense pe where pe.company_id = cl.company_id and pe.category = cl.value);
end $$;
