-- 0238: close the unused coupons table to studios.
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
