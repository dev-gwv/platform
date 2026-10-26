-- 0283: support calls are read from a Google Calendar (owner, 26 Oct).
--
-- The booking app's developer may never send us a notice, so bookings come
-- from the calendar they land in: a calendar used only for support calls,
-- whose private address ("Secret address in iCal format") the platform admin
-- pastes on Platform -> Support calls. The five-minute messages tick reads it
-- and turns a new entry into "booked", a changed time into "moved", and a
-- removed or cancelled entry into "cancelled" (lib/support-calendar.ts).
--
-- The address is a secret (anyone holding it reads that calendar), so it
-- lives on platform_settings, which no studio can read, and is never sent back
-- whole to the page. Safe to run twice.
alter table platform_settings add column if not exists support_ical_url text;
alter table platform_settings add column if not exists support_ical_checked_at timestamptz;
alter table platform_settings add column if not exists support_ical_error text;
-- The first read only learns what is already there; it posts nothing.
alter table platform_settings add column if not exists support_ical_primed boolean not null default false;
