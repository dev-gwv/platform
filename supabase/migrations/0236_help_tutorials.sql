-- 0236: Help & Tutorials.
--
--   * platform_settings gains the support contacts the Help panel offers:
--     support_whatsapp (digits with country code, e.g. 919876543210) and
--     support_email. Until a number is set, Help shows only Email.
--   * help_faqs: the questions Help answers, in order, platform-wide. Seeded
--     with the ones studios ask first; the platform admin edits them on
--     /platform/help.
--   * help_videos: a video for a page, by page key ("leads", "quotation" ...).
--     The app ships its own recorded tutorials; a row here adds one for a page
--     that has none, or replaces the shipped one with a newer link.
--
-- Everything here is public reading (the /help page works signed out) and
-- written only by the API for a platform admin, as the service.

alter table platform_settings
  add column if not exists support_whatsapp text check (support_whatsapp is null or support_whatsapp ~ '^[0-9]{10,15}$'),
  add column if not exists support_email text check (support_email is null or support_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

create table if not exists help_faqs (
  id          uuid primary key default gen_random_uuid(),
  question    text not null check (length(btrim(question)) between 3 and 300),
  answer      text not null check (length(btrim(answer)) between 1 and 4000),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists help_videos (
  page_key    text primary key check (page_key ~ '^[a-z][a-z0-9-]{1,40}$'),
  title       text not null check (length(btrim(title)) between 2 and 120),
  url         text not null check (url ~ '^https://'),
  updated_at  timestamptz not null default now()
);

alter table help_faqs enable row level security;
alter table help_videos enable row level security;
revoke all on help_faqs, help_videos from public, anon, authenticated;
grant select, insert, update, delete on help_faqs, help_videos to service_role;

insert into help_faqs (question, answer, sort_order)
select q, a, o from (values
  ('Can Studio AutoPilot see my clients and prices?',
   'No. Your clients, prices and payments belong to your studio alone. Our team never opens your studio''s data unless you ask us to help with something specific, and every studio is kept apart from every other one.', 10),
  ('Do my team members need an email to sign in?',
   'No. Any email works as a username, even a made-up one. Give them the email and password you set under Team, and they sign in with that. Nothing on their side asks them to confirm an email.', 20),
  ('What does my team see when they sign in?',
   'Only their own work: their shoots, their edits, their attendance and their own payouts. They never see your clients'' phone numbers, project prices or anyone else''s pay, unless you give them that access.', 30),
  ('How do I send a quotation to a client?',
   'Open the project, go to Quotation, and press Send to client. You can send it on WhatsApp or by email, or copy the link. Use "See it as the client" first to check exactly what they will see.', 40),
  ('Can I use it on my phone?',
   'Yes. Open studioautopilot.in in your phone''s browser and choose "Add to Home screen". It opens like an app, and your team can do the same.', 50),
  ('How do I record a payment from a client?',
   'Open the project, go to Finance, then Billing, and press Add payment from client. If it has not arrived yet, save it as pending: it shows as promised, not as money received.', 60),
  ('What happens when my trial ends?',
   'Nothing is deleted. Pick a plan under Settings, then Plan & billing, and everything carries on exactly as you left it.', 70)
) as v(q, a, o)
where not exists (select 1 from help_faqs);
