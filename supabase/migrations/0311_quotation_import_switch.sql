-- 0311: Upload a quotation, and the project makes itself (owner, 18 Nov).
--
-- The owner asked for this to be live in one studio first: the one their own
-- test login (afreenekram98@gmail.com) owns. No "try new features" switch on
-- screen -- the button simply appears on Projects for a studio that has it.
-- `companies.quote_import` is that switch; a later migration turns it on for
-- everyone, or the platform owner flips it for one studio.
--
-- Safe to run twice.

alter table companies add column if not exists quote_import boolean not null default false;

-- The studio that login owns or runs (its own profile, or a profile linked to
-- the same login). The login's email only: a studio profile's email can be
-- anything a studio typed for a team member.
update companies c
   set quote_import = true
  from users u
  join auth.users au on au.id = auth_identity_of(u.user_id)
 where u.company_id = c.id
   and u.deleted_at is null
   and (u.user_id = c.owner_user_id or u.role in ('super_admin', 'admin'))
   and lower(trim(au.email)) = 'afreenekram98@gmail.com';
