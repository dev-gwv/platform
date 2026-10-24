-- 0280: support call bookings and their WhatsApp messages (owner, 24 Oct).
--
-- The booking app (the support call calendar) tells us of each booking,
-- reschedule and cancellation at POST /webhooks/support-call, signed with
-- SUPPORT_CALL_WEBHOOK_SECRET. We keep the booking, then send:
--   * to the person who booked, only when they ticked WhatsApp: a confirmation,
--     one reminder an hour before, and a note if it moves or is cancelled --
--     Meta-approved utility templates from the platform's official number;
--   * to the support group: a short line, posted by the group bot (the wa-bot
--     container, a spare SIM linked like WhatsApp Web). When the bot is off or
--     cannot post, the support team's own numbers get the official team
--     template instead.
-- Everything waits in one outbox: a notice sent twice never sends twice, a
-- failure is retried, and every message is kept with what WhatsApp answered.
-- Platform admins alone see or change any of it (Platform -> Support calls).
--
-- Service-only tables: the API reads and writes them as the service role.
-- Safe to run twice.

create table if not exists support_call_bookings (
  id uuid primary key default gen_random_uuid(),
  -- The booking app's own id for the booking; a reschedule keeps it.
  booking_ref text not null unique,
  status text not null default 'booked' check (status in ('booked', 'rescheduled', 'cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text,
  name text not null default '',
  email text,
  -- Digits with the country code first, e.g. 919876543210.
  phone text,
  -- They ticked "remind me on WhatsApp": the only consent we send to them on.
  whatsapp_ok boolean not null default false,
  meeting_url text,
  notes text,
  -- Which studio asked and from where (the utm tags the in-app button adds).
  company_id uuid references companies(id) on delete set null,
  studio_name text,
  page text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_call_bookings_starts_idx on support_call_bookings (starts_at);

-- Every notice the booking app sent, by its id, so a retried notice is a no-op.
create table if not exists support_call_events (
  event_id text primary key,
  kind text not null,
  booking_ref text not null,
  received_at timestamptz not null default now()
);

create table if not exists support_call_outbox (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references support_call_bookings(id) on delete cascade,
  -- 'official': a template from the platform's number; 'group': the bot's post.
  channel text not null check (channel in ('official', 'group')),
  -- Who it is for, said plainly on the Platform page.
  audience text not null check (audience in ('booker', 'team', 'group')),
  to_number text,
  template text,
  params jsonb not null default '[]'::jsonb,
  body text,
  -- One message per purpose: a booking's confirmation, reminder, team alert.
  dedupe_key text not null unique,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  provider_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_call_outbox_due_idx on support_call_outbox (status, send_after);
create index if not exists support_call_outbox_sent_idx on support_call_outbox (channel, sent_at);

alter table support_call_bookings enable row level security;
alter table support_call_events enable row level security;
alter table support_call_outbox enable row level security;
revoke all on support_call_bookings, support_call_events, support_call_outbox from public, anon, authenticated;
grant select, insert, update, delete on support_call_bookings, support_call_events, support_call_outbox to service_role;

-- The switches and numbers, on Platform -> Support calls. Everything starts off.
alter table platform_settings add column if not exists support_wa_official_on boolean not null default false;
alter table platform_settings add column if not exists support_wa_bot_on boolean not null default false;
alter table platform_settings add column if not exists support_wa_team_numbers text[] not null default '{}';
alter table platform_settings add column if not exists support_wa_group_jid text;
alter table platform_settings add column if not exists support_wa_group_name text;
alter table platform_settings add column if not exists support_wa_hourly_cap int not null default 20;
alter table platform_settings add column if not exists support_wa_daily_cap int not null default 100;
alter table platform_settings add column if not exists support_wa_daily_summary boolean not null default true;
-- The Meta-approved template names (utility, English), changeable without a deploy.
alter table platform_settings add column if not exists support_wa_tpl_booked text not null default 'support_call_booked';
alter table platform_settings add column if not exists support_wa_tpl_reminder text not null default 'support_call_reminder';
alter table platform_settings add column if not exists support_wa_tpl_cancelled text not null default 'support_call_cancelled';
alter table platform_settings add column if not exists support_wa_tpl_team text not null default 'support_call_team';
