-- 0307: what a plan covers in Frameline -- Google Drive galleries, up to a number of photos kept (owner, 17 Nov).
--
-- Importing from Google Drive copies every photo into Frameline's storage (the full file and a 2048 px copy),
-- and the gallery is served from there, so it costs storage for as long as it is kept. The owner chose an
-- allowance per plan, with more sold by the team on WhatsApp:
--   Pro (regular and Diamond)          25,000 photos kept
--   Studio Max (regular and Diamond)   75,000
--   the trial                           3,000 (one wedding to try)
--   Starter                             none (Drive import stays locked, 0292)
-- plus whatever the platform owner adds for a studio (companies.gallery_photos_extra, "Add gallery photos" in
-- Studio Access Manager). Frameline is told with every token we sign (`cover`, lib/frameline.ts) and counts
-- Drive imports against it instead of its own quota and trial; uploads from a computer stay Frameline's.
--
-- Safe to run twice.

update plans set limits = coalesce(limits, '{}'::jsonb) || '{"gallery_photos": 25000}'::jsonb where tier = 'pro';
update plans set limits = coalesce(limits, '{}'::jsonb) || '{"gallery_photos": 75000}'::jsonb where tier = 'max';

alter table companies add column if not exists gallery_photos_extra int not null default 0;
do $$ begin
  alter table companies add constraint companies_gallery_photos_extra_check check (gallery_photos_extra >= 0);
exception when duplicate_object then null; end $$;

-- What the studio's plan covers in Frameline now: the plan's name, when the cover ends and how many photos it
-- keeps. No row: nothing (Starter, or no access). A platform admin's own studio (open for life, 0288) gets
-- Studio Max's number.
create or replace function gallery_cover(p_company uuid)
returns table (plan text, until timestamptz, photos int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c     companies;
  v_p     plans;
  v_extra int;
begin
  select * into v_c from companies where id = p_company;
  if not found then return; end if;
  v_extra := coalesce(v_c.gallery_photos_extra, 0);
  v_p := company_plan(p_company);
  if v_p.id is not null then
    if v_p.tier = 'starter' and not company_can(p_company, 'drive_import') then return; end if;
    return query select v_p.name::text, v_c.plan_expiry,
      coalesce(nullif(v_p.limits ->> 'gallery_photos', '')::int, case v_p.tier when 'max' then 75000 else 25000 end) + v_extra;
    return;
  end if;
  if v_c.grandfathered_until is not null and v_c.grandfathered_until > now() then
    if v_c.grandfathered_until >= '2099-01-01'::timestamptz then
      return query select 'Open for life'::text, v_c.grandfathered_until, 75000 + v_extra;
    else
      return query select 'Trial'::text, v_c.grandfathered_until, 3000 + v_extra;
    end if;
  end if;
end;
$$;
revoke all on function gallery_cover(uuid) from public, anon;
grant execute on function gallery_cover(uuid) to authenticated, service_role;

-- More Drive gallery photos for one studio, after the team has sold them on WhatsApp. A negative number takes
-- some back (never below zero). Platform admins only.
create or replace function platform_add_gallery_photos(p_company uuid, p_photos int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_extra int;
begin
  if not is_platform_admin() then
    raise exception 'platform access only' using errcode = '42501';
  end if;
  update companies set gallery_photos_extra = greatest(0, gallery_photos_extra + p_photos)
   where id = p_company returning gallery_photos_extra into v_extra;
  if not found then
    raise exception 'unknown studio' using errcode = '42501';
  end if;
  insert into billing_events (company_id, kind, detail)
    values (p_company, 'gallery_photos_added', jsonb_build_object('photos', p_photos, 'extra', v_extra, 'by', auth.uid()));
  return v_extra;
end;
$$;
revoke all on function platform_add_gallery_photos(uuid, int) from public, anon;
grant execute on function platform_add_gallery_photos(uuid, int) to authenticated;
