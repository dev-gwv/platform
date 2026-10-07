-- 0250: someone invited to a studio who signs in with Google joins it there.
--
-- A team member invited by email who pressed "Continue with Google" instead of
-- opening the link had a login with no studio: Complete setup refused them
-- ("you have already been invited"), and the link's page asked for a password
-- a Google login does not have. Google has already proved the mailbox, which
-- is all the link proves, so the signed-in login may take the invitation.
--
-- The membership is made exactly as consume_user_invitation (0159) makes it --
-- a profile under the login, the invited role, pending details and job roles --
-- only without a link or a password.

create or replace function join_invitation_as(p_identity uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_inv   user_invitations%rowtype;
  v_user  uuid;
  v_role  uuid;
begin
  -- Only a real login whose mailbox is proved.
  select email into v_email
    from auth.users
   where id = p_identity and identity_id is null and email is not null and email_verified;
  if v_email is null then
    return null;
  end if;

  select * into v_inv
    from user_invitations
   where lower(email) = lower(v_email)
     and accepted_at is null
     and revoked_at is null
     and expires_at > now()
   order by created_at desc
   limit 1
   for update;
  if v_inv.id is null then
    return null;
  end if;

  select p.profile_id into v_user
    from list_login_profiles(p_identity) p
   where p.company_id = v_inv.company_id;
  if v_user is null then
    insert into auth.users (email, encrypted_password, email_verified, email_verified_at, identity_id)
    values (null, null, true, now(), p_identity)
    returning id into v_user;
  end if;

  if not exists (select 1 from users where user_id = v_user) then
    insert into users (
      user_id, company_id, role, name, email, phone, alternate_phone,
      status, employee_type, salary, address, engagement_type, login_enabled
    ) values (
      v_user, v_inv.company_id, v_inv.role, v_inv.pending_name, v_inv.email,
      v_inv.pending_phone, v_inv.pending_alternate_phone,
      'active',
      case when v_inv.role = 'employee' then 1 else 2 end,
      v_inv.pending_salary, v_inv.pending_address, v_inv.pending_engagement_type, true
    );
  end if;

  foreach v_role in array v_inv.pending_role_ids loop
    insert into employee_role_assignments (user_id, role_id, company_id)
    values (v_user, v_role, v_inv.company_id)
    on conflict do nothing;
  end loop;

  update user_invitations
     set accepted_at = now(), accepted_by = v_user
   where id = v_inv.id;

  return v_user;
end;
$$;
revoke all on function join_invitation_as(uuid) from public, anon, authenticated;
grant execute on function join_invitation_as(uuid) to service_role;
