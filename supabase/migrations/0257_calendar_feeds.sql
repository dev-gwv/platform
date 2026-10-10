-- 0257: shoots in Google Calendar (owner, 10 Oct: "the crew bookings in
-- Google Calendar is a good thing").
--
-- A calendar link a person subscribes to once (Google Calendar → Other
-- calendars → From URL); Google reads it again every few hours, so a booking
-- made, moved or released shows up without anyone sending a file.
--
--   * 'mine'   -- the person's own bookings, for anyone with a login.
--   * 'studio' -- every shoot in the studio with its crew, for the people who
--                 plan them (owner, admin, manager).
--
-- The link carries a long random token: whoever holds it reads the calendar,
-- so it never shows pay, a client's phone or anything private, and "Make a
-- new link" ends the old one. One live link per person, studio and kind.
-- Service-only, like client_portal_link_tokens (0252): the API checks who is
-- asking before it reads or writes a row.

create table if not exists calendar_feed_tokens (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies (id) on delete cascade,
  user_id      uuid not null references users (user_id) on delete cascade,
  scope        text not null check (scope in ('mine', 'studio')),
  token        text not null unique,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  last_read_at timestamptz
);

create unique index if not exists calendar_feed_tokens_live
  on calendar_feed_tokens (company_id, user_id, scope)
  where revoked_at is null;

alter table calendar_feed_tokens enable row level security;
revoke all on calendar_feed_tokens from public, anon, authenticated;
grant all on calendar_feed_tokens to service_role;
