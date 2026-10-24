-- 0279: the support call can open inside the app, and its link follows the
-- booking app's rename (owner, 21-24 Oct).
--
-- support_call_in_app: when on, Book a support call opens the booking app's
-- calendar in a popup over Studio AutoPilot (its /embed/<owner>/<event> page)
-- instead of a new tab. Off until the booking app lists
-- https://studioautopilot.in in its EMBED_ALLOWED_ORIGINS: before that it
-- answers "frame-ancestors 'none'" and the popup would be blank. The platform
-- owner turns it on beside the call link on Platform -> Help.
--
-- The booking app renamed the intro-call event to support-call and forwards
-- the old address. 0272 stored the old one; it moves only if nobody has
-- changed it since. Safe to run twice.
alter table platform_settings add column if not exists support_call_in_app boolean not null default false;

update platform_settings
   set support_call_url = 'https://calendly-common-meeting-web-bjvr.vercel.app/harsh-solanki/support-call'
 where support_call_url = 'https://calendly-common-meeting-web-bjvr.vercel.app/harsh-solanki/intro-call';
