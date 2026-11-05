-- 0293: Pro and Studio Max cards say "Photo Sharing App via Google Drive"
-- (owner, 5 Nov: "add this feature in the Diamond Pro plan and write it
-- over there"). The Gallery's Import from Google Drive is Pro and above
-- since 0292; the card now says so in its words. Cards stay at three lines:
-- Pro gives up "Every feature, no limits" (the chips under the cards say it
-- for every plan) and Studio Max "Priority help" (still in Compare plans).
-- Safe to run twice.

update plans
   set features = jsonb_build_array('Unlimited projects, leads and team', 'Photo Sharing App via Google Drive', 'Up to 3 brands on one login'),
       updated_at = now()
 where tier = 'pro';

update plans
   set features = jsonb_build_array('Everything unlimited, as many brands as you like', 'Photo Sharing App via Google Drive', 'Your own name, logo and WhatsApp number (white label)'),
       updated_at = now()
 where tier = 'max';
