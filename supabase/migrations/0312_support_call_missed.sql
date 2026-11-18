-- 0312: a missed support call gets a WhatsApp with a new booking link
-- (owner, 18 Nov: "send new meeting links to the user whose meetings were
-- missed, so they can rejoin"; the owner taps Missed, nothing guesses).
--
-- The owner taps **Missed** on the ticket (the after-call group post links
-- to it). If the person ticked WhatsApp and the switch is on, our official
-- number sends the fixed utility template `support_call_missed`
-- (name, the call's time, the booking page), and once more 24 hours later
-- unless they have booked again or the ticket moved on. Never AI-written.
-- Rules: lib/support-calls.ts (planMissedMessages); sending:
-- lib/support-call-store.ts; the route: modules/support-calls.
--
-- Off until switched on (Platform -> Support calls). Safe to run twice.

alter table platform_settings add column if not exists support_wa_missed_on boolean not null default false;
alter table platform_settings add column if not exists support_wa_tpl_missed text not null default 'support_call_missed';

alter table support_tickets add column if not exists missed_at timestamptz;
