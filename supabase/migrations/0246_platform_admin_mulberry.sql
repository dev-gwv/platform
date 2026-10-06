-- 0246: connect@themulberryweddings.in is a platform admin too (the owner's
-- word, 6 Oct): Studio Access Manager and the rest of the Platform console.
--
-- The same seed as 0219, for the login and for any studio profile behind
-- it, trimmed and lower-cased. An account not made yet gets nothing here;
-- run this insert again once it signs up. A new platform admin is added by
-- a migration copied from this one.

insert into platform_admins (user_id)
select au.id from auth.users au
 where lower(trim(au.email)) = 'connect@themulberryweddings.in'
union
select auth_identity_of(u.user_id) from users u
 where lower(trim(u.email)) = 'connect@themulberryweddings.in'
   and u.deleted_at is null
on conflict do nothing;
