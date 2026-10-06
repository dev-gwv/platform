-- 0247: the help assistant.
--
-- A studio owner opens the assistant from the header and asks a question in
-- their own words. It answers from the help content the app already ships --
-- the /learn guide, the tutorials and the FAQs on /platform/help -- and offers
-- a call when it cannot.
--
-- What it can see is deliberately narrow: help content only, never the studio's
-- leads, projects or money. That keeps the whole feature outside the class of
-- bug where one studio is shown another's figures.
--
--   * platform_settings gains the assistant's own settings, so the prompt and
--     the model change from /platform/assistant without a deploy. The API key
--     stays in the server env and never lands in a row here.
--   * assistant_log: one row per question, and what the model answered. Modelled
--     on email_log (0217) for the same reason -- without it, "the assistant is
--     unhelpful" cannot be told apart from "nobody opens it", and the first is a
--     prompt problem while the second is a placement problem.
--   * assistant_asked_today(): the per-studio ceiling. The per-IP rate limit in
--     the API is an abuse ceiling, not a quota: a studio behind one office
--     connection shares an address with its whole team.

-- ── what the assistant is, and how to reach a human ───────────
alter table platform_settings
  -- Empty means "use the prompt built into the server". A studio never sees
  -- this; it is the vendor's instruction to the model.
  add column if not exists assistant_prompt text
    check (assistant_prompt is null or length(assistant_prompt) <= 8000),
  -- Model and base URL together choose the provider. Both empty falls back to
  -- the server env, so switching provider needs no row change in an emergency.
  add column if not exists assistant_model text
    check (assistant_model is null or assistant_model ~ '^[A-Za-z0-9._/:-]{1,120}$'),
  add column if not exists assistant_base_url text
    check (assistant_base_url is null or assistant_base_url ~ '^https://'),
  -- Off until somebody turns it on. A half-configured assistant that answers
  -- confidently from an empty prompt is worse than no assistant.
  add column if not exists assistant_enabled boolean not null default false,
  -- Where "book a call" sends them. Falls back to ONBOARDING_CALL_URL.
  add column if not exists support_call_url text
    check (support_call_url is null or support_call_url ~ '^https://'),
  -- Questions one studio may ask in a day. Null means the server's default.
  add column if not exists assistant_daily_limit int
    check (assistant_daily_limit is null or assistant_daily_limit between 1 and 1000);

-- ── every question, and what came back ────────────────────────
create table if not exists assistant_log (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid references companies (id) on delete set null,
  user_id           uuid,
  question          text not null,
  answer            text,
  -- 'answered'  the model replied from the help content
  -- 'escalated' it offered a call instead
  -- 'skipped'   no API key on the server; nothing was sent
  -- 'failed'    the provider refused or could not be reached
  status            text not null check (status in ('answered', 'escalated', 'skipped', 'failed')),
  model             text,
  prompt_tokens     int,
  completion_tokens int,
  error             text,
  created_at        timestamptz not null default now()
);

create index if not exists assistant_log_time_idx on assistant_log (created_at desc);
-- The quota reads this every question, so it gets its own index rather than
-- scanning a growing log.
create index if not exists assistant_log_company_day_idx on assistant_log (company_id, created_at desc);

-- Service-only, like email_log: a studio never reads it, and the platform admin
-- reads it through the API. RLS on with no policy denies everyone by default;
-- the revoke is belt and braces in case 0000 granted the table broadly.
alter table assistant_log enable row level security;
revoke all on assistant_log from public, anon, authenticated;
grant select, insert, delete on assistant_log to service_role;

-- ── the per-studio ceiling ────────────────────────────────────
-- Counts only what actually cost something: a question skipped for want of a
-- key, or one the provider refused, does not burn a studio's allowance.
create or replace function assistant_asked_today(p_company uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from assistant_log
   where company_id = p_company
     and status in ('answered', 'escalated')
     and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
$$;

revoke all on function assistant_asked_today(uuid) from public, anon, authenticated;
