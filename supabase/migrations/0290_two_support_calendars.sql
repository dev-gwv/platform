-- 0290: support calls are booked with two people, each on their own Google
-- Calendar (owner, 29 Oct: "connect 2 accounts of google calendar and users
-- can book the calls there"; the old Calendly-style booking page removed).
--
-- One row per person (slot 1 and 2): the name the studio sees on the chooser,
-- the Google appointment schedule's booking page, and that calendar's private
-- iCal address, which the five-minute messages tick reads (0283's reader, now
-- once per calendar, lib/support-calendar-sync.ts). Book a support call opens
-- the booking page in a new tab, or a small chooser when both are set.
--
-- The iCal address is a secret (anyone holding it reads that calendar), so the
-- table is service-only and the page only ever sees it masked.
--
-- Slot 1 takes over 0283's calendar and the Help console's call link, unless
-- that link is still the old Calendly page, which is dropped everywhere.
-- platform_settings.support_ical_* and support_call_url stay as unused columns
-- rather than drops under the running API. Safe to run twice.
create table if not exists support_calendars (
  slot smallint primary key check (slot in (1, 2)),
  name text,
  booking_url text,
  ical_url text,
  checked_at timestamptz,
  error text,
  -- The first read of a new address only learns what is already there.
  primed boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table support_calendars enable row level security;
revoke all on support_calendars from public, anon, authenticated;
grant select, insert, update, delete on support_calendars to service_role;

insert into support_calendars (slot) values (1), (2) on conflict (slot) do nothing;

update support_calendars s
   set ical_url = p.support_ical_url,
       checked_at = p.support_ical_checked_at,
       error = p.support_ical_error,
       primed = p.support_ical_primed,
       booking_url = case when p.support_call_url ilike '%calendly%' then null else nullif(trim(p.support_call_url), '') end,
       updated_at = now()
  from platform_settings p
 where s.slot = 1 and s.ical_url is null and s.booking_url is null;

update platform_settings set support_call_url = null where support_call_url ilike '%calendly%';
