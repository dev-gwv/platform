-- 0287: solankiharsh0217@gmail.com is a platform admin too (the owner's word,
-- 27 Oct): Studio Access Manager and the rest of the Platform console.
--
-- Copied from 0246: the login and any studio profile behind it, trimmed and
-- lower-cased. An account not made yet gets nothing here; run this insert
-- again once it signs up. Safe to run twice.

insert into platform_admins (user_id)
select au.id from auth.users au
 where lower(trim(au.email)) = 'solankiharsh0217@gmail.com'
union
select auth_identity_of(u.user_id) from users u
 where lower(trim(u.email)) = 'solankiharsh0217@gmail.com'
   and u.deleted_at is null
on conflict do nothing;
