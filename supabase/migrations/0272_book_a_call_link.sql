-- 0272: the owner's booking page is where "Book a call" goes (owner, 19 Oct).
--
-- The assistant's hand-over, the help bubble and the support requests offer
-- Book a call when platform_settings.support_call_url is set (0247). Filled
-- only when nobody has set one, so a link changed on Platform -> Help is kept.
update platform_settings
   set support_call_url = 'https://calendly-common-meeting-web-bjvr.vercel.app/harsh-solanki/intro-call'
 where coalesce(support_call_url, '') = '';
