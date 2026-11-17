-- 0308: Studio Access Manager says which plan each studio bought; the plan cards say how many Drive gallery photos
-- they include; and every studio owner is told about it once, in the bell (owner, 17 Nov).
--
-- 1. platform_list_studios() (copied from 0245, the latest) gains the plan's key and name and the studio's extra
--    gallery photos. The list and the details showed only "Active", so the owner could not see who bought what.
--    The return type changes, so the function is dropped first.
-- 2. Pro and Studio Max cards: "Photo Sharing App via Google Drive" now carries its number (0307).
-- 3. One bell note for each studio's owner: Google Drive galleries are part of Pro and Studio Max, with how many
--    photos, and that more are on WhatsApp. It opens Photo sharing. Never twice (dedupe_key).
--
-- Safe to run twice.

drop function if exists platform_list_studios();
create function platform_list_studios()
returns table (
  id                   uuid,
  name                 text,
  owner_email          text,
  plan_gate            text,
  plan_expiry          timestamptz,
  user_count           bigint,
  project_count        bigint,
  created_at           timestamptz,
  access_until         timestamptz,
  member_tier          text,
  owner_name           text,
  owner_phone          text,
  plan_key             text,
  plan_name            text,
  gallery_photos_extra int
)
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
    select
      c.id,
      c.name,
      owner.email,
      platform_plan_gate(c.plan_expiry, c.grandfathered_until, c.grace_until),
      c.plan_expiry,
      (select count(*) from users u where u.company_id = c.id and u.deleted_at is null),
      (select count(*) from projects p where p.company_id = c.id),
      c.created_at,
      company_access_until(c.plan_expiry, c.grandfathered_until, c.grace_until),
      c.member_tier,
      nullif(btrim(owner.name), ''),
      coalesce(nullif(btrim(owner.phone), ''), nullif(btrim(c.invoice_phone), '')),
      c.plan,
      p.name::text,
      c.gallery_photos_extra
    from companies c
    left join users owner on owner.user_id = c.owner_user_id
    left join plans p on p.key = c.plan
    order by c.created_at desc;
end;
$$;
revoke all on function platform_list_studios() from public, anon;
grant execute on function platform_list_studios() to authenticated;

update plans
   set features = (select jsonb_agg(case when f = 'Photo Sharing App via Google Drive'
                                         then to_jsonb('Photo Sharing App via Google Drive · ' ||
                                                       case tier when 'max' then '75,000' else '25,000' end || ' photos')
                                         else to_jsonb(f) end)
                     from jsonb_array_elements_text(features) f),
       updated_at = now()
 where tier in ('pro', 'max')
   and features ? 'Photo Sharing App via Google Drive';

insert into notifications (company_id, recipient_uid, type, title, body, deep_link, dedupe_key)
select c.id, c.owner_user_id, 'announcement',
       'Google Drive galleries are now part of your plan',
       'Import a shoot from Google Drive into a project''s gallery and share it with a link and PIN. Pro includes 25,000 photos, '
       || 'Studio Max 75,000 and the free trial 3,000. Photo sharing shows how many you have used. Need more? Ask us on WhatsApp.',
       '/galleries',
       'news:gallery_cover'
  from companies c
  join auth.users au on au.id = c.owner_user_id
 where c.owner_user_id is not null
on conflict (company_id, recipient_uid, dedupe_key) do nothing;
