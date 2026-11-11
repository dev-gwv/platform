-- 0300: a ticket for every support call, and an assistant that keeps it (owner, 11 Nov).
--
-- The owner takes every support call alone and asked for a helper that eases
-- the work, not another screen to fill in. So a ticket opens by itself for
-- each booking (0280) and the API keeps it:
--   * an hour before the call it writes a short brief from the studio's own
--     data and posts it in the support group (only the owner and the bot);
--   * after the call it asks for a voice note in the group, with a link;
--   * the voice note (Groq Whisper) becomes the summary, the kind of call,
--     the next action and a status, which the owner can change;
--   * the 9 am post says how many are open and what waits on the owner.
-- Nothing here messages a studio. Tickets come only from booked calls -- it is
-- not a support inbox (0273 stands).
--
-- Service-only, like the bookings: the API reads and writes it as the service
-- role, and only platform admins reach those routes. Safe to run twice.

create table if not exists support_tickets (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null unique references support_call_bookings(id) on delete cascade,
  company_id  uuid references companies(id) on delete set null,
  status      text not null default 'booked'
              check (status in ('booked', 'open', 'waiting_us', 'waiting_them', 'solved', 'cancelled')),
  kind        text check (kind in ('training', 'bug', 'billing', 'feature', 'other')),
  -- Written before the call from the studio's data.
  brief       text,
  brief_at    timestamptz,
  -- What the owner said after the call, and what the assistant made of it.
  transcript  text,
  summary     text,
  next_action text,
  due_on      date,
  solved_at   timestamptz,
  -- The after-call "add a voice note" post went out.
  nudged_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists support_tickets_status_idx on support_tickets (status);
create index if not exists support_tickets_company_idx on support_tickets (company_id);

alter table support_tickets enable row level security;
revoke all on support_tickets from public, anon, authenticated;
grant select, insert, update, delete on support_tickets to service_role;

-- Every booking already kept gets its ticket. Calls more than a day old are
-- not asked about again (nudged_at set), so the first run never floods the group.
insert into support_tickets (booking_id, company_id, status, nudged_at)
select b.id, b.company_id,
       case when b.status = 'cancelled' then 'cancelled' else 'booked' end,
       case when b.starts_at < now() - interval '1 day' then now() end
  from support_call_bookings b
on conflict (booking_id) do nothing;
