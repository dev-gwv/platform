-- 0311: Upload a quotation, and the project makes itself (owner, 18 Nov).
--
-- The owner asked for this to be live in one studio first: the one their own
-- test login (afreenekram98@gmail.com) owns. No "try new features" switch on
-- screen -- the button simply appears on Projects for a studio that has it.
-- `companies.quote_import` is that switch; a later migration turns it on for
-- everyone, or the platform owner flips it for one studio.
--
-- Safe to run twice.

alter table companies add column if not exists quote_import boolean not null default false;

-- The studio's own Google Forms and the WhatsApp message that goes with each,
-- written into the tasks the upload gives the manager:
--   {"e_invite": {"form": url, "reference": url, "message": text},
--    "event_timeline": {"form": url, "message": text}}
-- Null: the tasks still say what to send, without a link.
alter table companies add column if not exists quote_import_forms jsonb;

-- The studio that login owns or runs (its own profile, or a profile linked to
-- the same login). The login's email only: a studio profile's email can be
-- anything a studio typed for a team member.
update companies c
   set quote_import = true,
       quote_import_forms = coalesce(c.quote_import_forms, jsonb_build_object(
         'e_invite', jsonb_build_object(
           'form', 'https://docs.google.com/forms/d/e/1FAIpQLSfW2MGd7aSYfo8zDJg3dhj70sXEHFMOUlnriVzFhhOUfQo3xA/viewform?usp=sf_link',
           'reference', 'https://drive.google.com/drive/folders/1DFstaS_H5eL0s7ok9AiI7mRRdfSlIZVo?usp=sharing',
           'message', E'Hello\U0001F90D\n\nAs we prepare for your upcoming event, we''d like to gather the necessary details to design your invitation. Please fill out the form at the link below.\n\nForm link: {form}\n\nReference link: {reference}\n\nThank you\U0001F33A'),
         'event_timeline', jsonb_build_object(
           'form', 'https://docs.google.com/forms/d/e/1FAIpQLScSE8yE6kNjrhShuTBMmI2kx3VMbQyA6Y3YAbNg4zk1OFKx5Q/viewform?usp=sf_link',
           'message', E'Helloo\U0001F90D\n\nHope you are doing great! I have attached a form with this message. Please help us by filling this form with details like locations and the timings. Your input will help us reach each location on time and ensure every moment aligns with your vision.\n\n{form}\n\nThank You\u2728 We look forward to your valuable input')))
  from users u
  join auth.users au on au.id = auth_identity_of(u.user_id)
 where u.company_id = c.id
   and u.deleted_at is null
   and (u.user_id = c.owner_user_id or u.role in ('super_admin', 'admin'))
   and lower(trim(au.email)) = 'afreenekram98@gmail.com';
