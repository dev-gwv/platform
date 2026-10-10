-- 0260: a second provider for the assistant, and a ceiling that knows what the
-- provider actually allows.
--
-- 0247 gave the assistant two ceilings: a per-address rate limit in the API
-- (an abuse ceiling) and assistant_asked_today() (a per-studio allowance). Both
-- count questions, and neither knows anything about the budget those questions
-- are spent against.
--
-- That budget is a platform resource, not a tenant one. Groq's free tier for
-- openai/gpt-oss-120b allows 8,000 tokens a minute and 200,000 a day across
-- every studio at once. At roughly 1,700 counted tokens a question that is
-- about four questions a minute and a hundred a day for the whole platform --
-- while the ceilings we had would happily let a single studio ask ten in a
-- minute and fifty in a day. Two busy studios could spend the entire day's
-- allowance between them, and the third would be told the assistant is broken.
--
--   * platform_settings gains a second provider (base URL + model), so a
--     refusal from the first one falls through to another vendor instead of
--     stopping. The key lives in env (AI_FALLBACK_API_KEY), never in a row.
--   * platform_settings gains the two token budgets, so the ceiling is written
--     in the units the provider meters in.
--   * assistant_budget_used(): counted tokens in the last minute and today,
--     across every studio. Cached tokens are subtracted because the providers
--     do not count them either -- that is the whole reason the prompt is
--     split the way it is.
--   * assistant_asked_today() stops counting questions that never reached a
--     model. Its own comment in 0247 said it counted "only what actually cost
--     something", and then counted the refund guard's instant hand-off to a
--     person, which costs nothing at all.

-- ── a second vendor to fall through to ────────────────────────
alter table platform_settings
  -- Same shape as the first pair. Empty means "no second provider", which is
  -- the state every studio is in until somebody fills it in.
  add column if not exists assistant_fallback_base_url text
    check (assistant_fallback_base_url is null or assistant_fallback_base_url ~ '^https://'),
  add column if not exists assistant_fallback_model text
    check (assistant_fallback_model is null or assistant_fallback_model ~ '^[A-Za-z0-9._/:-]{1,120}$'),
  -- The provider's own budget, in the units it meters. Null means the server's
  -- default. Zero is not allowed: an accidental 0 would switch the assistant
  -- off for everyone with no message saying why.
  add column if not exists assistant_minute_tokens int
    check (assistant_minute_tokens is null or assistant_minute_tokens between 1000 and 10000000),
  add column if not exists assistant_day_tokens int
    check (assistant_day_tokens is null or assistant_day_tokens between 1000 and 1000000000);

-- ── what the platform has actually spent ──────────────────────
-- Counted tokens, not total: a cached prefix costs neither money nor rate
-- limit, which is why the prompt puts the unchanging part first. cached_tokens
-- is null for a provider that does not report one, so it is coalesced to zero
-- rather than poisoning the sum.
create or replace function assistant_budget_used()
returns table (minute_tokens int, day_tokens int)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(greatest(coalesce(prompt_tokens, 0) - coalesce(cached_tokens, 0), 0) + coalesce(completion_tokens, 0))
      filter (where created_at >= now() - interval '1 minute'), 0)::int,
    coalesce(sum(greatest(coalesce(prompt_tokens, 0) - coalesce(cached_tokens, 0), 0) + coalesce(completion_tokens, 0))
      filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'), 0)::int
  from assistant_log
  -- The day bound is the wider of the two, so the scan is bounded by the index
  -- rather than walking a log that only grows.
  where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
$$;

revoke all on function assistant_budget_used() from public, anon, authenticated;
grant execute on function assistant_budget_used() to service_role;

-- ── a studio's allowance counts only what reached a model ─────
-- Copied from 0247 and edited, never rebuilt from an older base.
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
     -- A hand-off decided before the call -- the refund and lost-data guards --
     -- writes no model, because no model was asked. It costs the platform
     -- nothing, so it costs the studio nothing.
     and model is not null
     and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'
$$;

-- 0247's revoke took service_role's default grant with it; 0248 put it back.
-- A create or replace keeps the existing grants, but this is cheap and makes
-- the file stand on its own.
grant execute on function assistant_asked_today(uuid) to service_role;
