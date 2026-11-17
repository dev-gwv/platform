-- 0309: studios do not see the Drive gallery photo numbers yet (owner, 17 Nov: "we havent decided what we are gonna
-- put on the frontend ... just u and me decide").
--
-- 1. Pro and Studio Max cards go back to "Photo Sharing App via Google Drive", without 0308's " · 25,000 photos".
-- 2. 0308's bell note to every owner ("Google Drive galleries are now part of your plan") is taken back.
--
-- The cover itself (0307: gallery_cover, plans.limits.gallery_photos, the extras) stays: Frameline still counts
-- Drive imports against it, and the platform admins still see and change it in Studio Access Manager.
--
-- Safe to run twice.

update plans
   set features = (select jsonb_agg(case when f like 'Photo Sharing App via Google Drive ·%'
                                         then to_jsonb('Photo Sharing App via Google Drive'::text)
                                         else to_jsonb(f) end)
                     from jsonb_array_elements_text(features) f),
       updated_at = now()
 where tier in ('pro', 'max')
   and exists (select 1 from jsonb_array_elements_text(features) f where f like 'Photo Sharing App via Google Drive ·%');

delete from notifications where dedupe_key = 'news:gallery_cover';
