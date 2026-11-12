-- 0304: studios talk to support on WhatsApp, and the assistant keeps the ticket (owner, 12 Nov).
--
-- The owner lifted 0273's "no written support inbox" rule for this: once the
-- official WhatsApp number is connected, a studio can write to it about a
-- problem. Each conversation is a ticket (0300's table, now also without a
-- booking). The assistant answers what the help can answer -- how-to,
-- where-is-it -- in the studio's own language, and hands the rest to the
-- owner: money, plan changes, lost data, a bug, "I want a person", anger, or
-- two answers that did not help. The owner is told in the support group with
-- the ticket's link and replies from the ticket page through the same number.
-- A booked call by the same studio joins its open chat ticket.
--
-- Everything starts off (`support_wa_chat_on`). Service-only, like the rest of
-- support. Safe to run twice.

alter table support_tickets alter column booking_id drop not null;

alter table support_tickets add column if not exists source text not null default 'call';
do $$ begin
  alter table support_tickets add constraint support_tickets_source_check check (source in ('call', 'chat'));
exception when duplicate_object then null; end $$;

-- A chat's number (digits, country code first) and the name WhatsApp gave.
alter table support_tickets add column if not exists phone         text;
alter table support_tickets add column if not exists contact_name  text;
-- The studio's last message: Meta allows a free reply for 24 hours after it.
alter table support_tickets add column if not exists last_in_at    timestamptz;
-- Handed to the owner, and why ("Asked for a person", "Money").
alter table support_tickets add column if not exists escalated_at  timestamptz;
alter table support_tickets add column if not exists escalate_why  text;
-- Answers the studio said did not help; two hand it to the owner.
alter table support_tickets add column if not exists ai_misses     int not null default 0;
-- One assistant at a time per ticket (Meta posts messages close together).
alter table support_tickets add column if not exists ai_lock_at    timestamptz;

create index if not exists support_tickets_chat_idx on support_tickets (phone, status) where source = 'chat';

create table if not exists support_ticket_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references support_tickets(id) on delete cascade,
  -- in: from the studio; out: to it.
  dir        text not null check (dir in ('in', 'out')),
  -- Who wrote it: the studio, the assistant, the owner, or a fixed line of ours.
  author     text not null check (author in ('studio', 'ai', 'owner', 'system')),
  body       text not null,
  -- Meta's message id: an inbound one is never kept twice when Meta retries.
  wa_id      text unique,
  -- An inbound message the assistant has not dealt with yet.
  pending    boolean not null default false,
  status     text not null default 'sent' check (status in ('sent', 'failed')),
  error      text,
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_messages_ticket_idx on support_ticket_messages (ticket_id, created_at);
create index if not exists support_ticket_messages_pending_idx on support_ticket_messages (created_at) where pending;

alter table support_ticket_messages enable row level security;
revoke all on support_ticket_messages from public, anon, authenticated;
grant select, insert, update, delete on support_ticket_messages to service_role;

alter table platform_settings add column if not exists support_wa_chat_on boolean not null default false;
