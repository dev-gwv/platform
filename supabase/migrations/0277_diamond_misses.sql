-- 0277: Diamond members who could not confirm (owner, 20 Oct).
--
-- Members said the check refused their number although they are on the list.
-- The platform owner had no way to see what was typed or why it missed. Now:
--   * every miss keeps the ten digits typed and why (not on the list, or the
--     number already opened another studio), so Platform → IPC Diamond
--     members lists them;
--   * the platform owner can look a number up against the copied list, and
--   * make a studio Diamond by hand, the same as a match would.
--
-- diamond_verify_phone is copied from 0262 with the digits kept on a miss.
-- Safe to run twice.

create or replace function diamond_verify_phone(p_company uuid, p_phone text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone  text;
  v_tries  int;
begin
  if exists (select 1 from companies where id = p_company and member_tier = 'diamond') then
    return 'already';
  end if;
  select count(*) into v_tries from billing_events
   where company_id = p_company and kind = 'diamond_phone_try' and created_at > now() - interval '1 day';
  if v_tries >= 10 then
    return 'too_many';
  end if;
  v_phone := case when length(v_digits) >= 10 then right(v_digits, 10) end;
  insert into billing_events (company_id, kind, detail)
    values (p_company, 'diamond_phone_try', jsonb_build_object('phone', v_phone));

  if v_phone is null then
    return 'not_found';
  end if;
  if not exists (select 1 from diamond_roster where phone = v_phone) then
    insert into billing_events (company_id, kind, detail)
      values (p_company, 'diamond_phone_miss', jsonb_build_object('phone', v_phone, 'why', 'not_found'));
    return 'not_found';
  end if;
  if exists (select 1 from companies where diamond_phone = v_phone and id <> p_company) then
    insert into billing_events (company_id, kind, detail)
      values (p_company, 'diamond_phone_miss', jsonb_build_object('phone', v_phone, 'why', 'taken'));
    return 'taken';
  end if;

  update companies c
     set member_tier = 'diamond',
         diamond_verified_at = now(),
         diamond_phone = v_phone,
         grandfathered_until = case
           when coalesce(c.plan_expiry, 'epoch'::timestamptz) > now() then c.grandfathered_until
           else greatest(coalesce(c.grandfathered_until, now()), c.created_at + interval '30 days')
         end
   where c.id = p_company;
  insert into billing_events (company_id, kind, detail)
    values (p_company, 'diamond_verified_phone', jsonb_build_object('phone_last4', right(v_phone, 4)));
  return 'verified';
end;
$$;
revoke all on function diamond_verify_phone(uuid, text) from public, anon, authenticated;
grant execute on function diamond_verify_phone(uuid, text) to service_role;

/**
 * The last 30 days of numbers that did not match, newest first, one line per
 * studio and number, leaving out studios that are Diamond now.
 */
create or replace function platform_diamond_misses()
returns table (company_id uuid, studio text, owner_email text, phone text, why text,
               tries int, last_at timestamptz, used_by text, on_list boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  return query
    select c.id, c.name, u.email::text, m.phone, m.why, m.tries::int, m.last_at,
           (select o.name from companies o where o.diamond_phone = m.phone and o.id <> c.id limit 1),
           exists (select 1 from diamond_roster r where r.phone = m.phone)
      from (select e.company_id, e.detail ->> 'phone' as phone,
                   (array_agg(e.detail ->> 'why' order by e.created_at desc))[1] as why,
                   count(*) as tries, max(e.created_at) as last_at
              from billing_events e
             where e.kind = 'diamond_phone_miss' and e.created_at > now() - interval '30 days'
             group by e.company_id, e.detail ->> 'phone') m
      join companies c on c.id = m.company_id
      left join auth.users u on u.id = c.owner_user_id
     where c.member_tier is distinct from 'diamond'
     order by m.last_at desc
     limit 200;
end;
$$;
revoke all on function platform_diamond_misses() from public, anon;
grant execute on function platform_diamond_misses() to authenticated;

/** Is this number on the copied list, and which studio (if any) it opened. */
create or replace function platform_diamond_lookup(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone  text;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  if length(v_digits) < 10 then
    raise exception 'Type a ten-digit mobile number.' using errcode = '22023';
  end if;
  v_phone := right(v_digits, 10);
  return jsonb_build_object(
    'phone', v_phone,
    'on_list', exists (select 1 from diamond_roster where phone = v_phone),
    'name', (select name from diamond_roster where phone = v_phone),
    'studio', (select name from companies where diamond_phone = v_phone limit 1));
end;
$$;
revoke all on function platform_diamond_lookup(text) from public, anon;
grant execute on function platform_diamond_lookup(text) to authenticated;

/**
 * Make a studio Diamond by hand, as a match would (30 days from sign-up when
 * it has no paid plan). The number is kept when no other studio holds it.
 */
create or replace function platform_diamond_grant(p_company uuid, p_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone  text := case when length(v_digits) >= 10 then right(v_digits, 10) end;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  if v_phone is not null and exists (select 1 from companies where diamond_phone = v_phone and id <> p_company) then
    v_phone := null;
  end if;
  update companies c
     set member_tier = 'diamond',
         diamond_verified_at = now(),
         diamond_phone = coalesce(v_phone, c.diamond_phone),
         grandfathered_until = case
           when coalesce(c.plan_expiry, 'epoch'::timestamptz) > now() then c.grandfathered_until
           else greatest(coalesce(c.grandfathered_until, now()), c.created_at + interval '30 days')
         end
   where c.id = p_company;
  if not found then
    raise exception 'unknown studio' using errcode = '42501';
  end if;
  insert into billing_events (company_id, kind, detail)
    values (p_company, 'diamond_granted', jsonb_build_object('by', auth.uid(), 'phone_last4', right(coalesce(v_phone, ''), 4)));
end;
$$;
revoke all on function platform_diamond_grant(uuid, text) from public, anon;
grant execute on function platform_diamond_grant(uuid, text) to authenticated;
