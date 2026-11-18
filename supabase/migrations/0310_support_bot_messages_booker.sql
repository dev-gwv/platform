-- 0310: the support bot may message the person who booked, twice at most
-- (owner, 18 Nov: "it's just so I can contact them and their contact is ready
-- in the WhatsApp account for me to continue the chat from").
--
-- The linked number (deploy/wa-bot) sends, from fixed words and never AI:
--   1. right after a booking: "your call is booked for <time>, reply here if
--      anything changes" -- no link, so the first message from a new number
--      does not look like spam, and it invites a reply;
--   2. ten minutes after the start, only while the ticket has no note:
--      "if we couldn't connect, reply here".
-- That opens the chat on the owner's WhatsApp so a missed call can carry on
-- there. Rules: lib/support-calls.ts (planBotMessages); sending:
-- lib/support-call-store.ts; the bot's own ceilings: deploy/wa-bot/server.mjs.
--
-- Off until switched on (Platform -> Support calls). Safe to run twice.

alter table platform_settings add column if not exists support_wa_bot_dm_on boolean not null default false;

-- A third channel: the bot writing to one person.
alter table support_call_outbox drop constraint if exists support_call_outbox_channel_check;
alter table support_call_outbox add constraint support_call_outbox_channel_check check (channel in ('official', 'group', 'bot'));
