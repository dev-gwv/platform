-- 0259: how much of the prompt the provider served from its cache.
--
-- Groq caches an identical prompt prefix and charges half for it -- and, which
-- matters more on the free tier, cached tokens do not count against the rate
-- limit at all. gpt-oss-120b allows 8,000 tokens a minute, so whether a prefix
-- hit the cache is the difference between a question that fits and one that is
-- refused.
--
-- The provider reports it (usage.prompt_tokens_details.cached_tokens) and we
-- were throwing it away, which left nobody able to answer "how close are we to
-- the limit" with anything but an estimate. Null means the provider said
-- nothing -- not zero, which is a real and much worse answer.

alter table assistant_log
  add column if not exists cached_tokens int;

-- No new grants: 0247 already gives service_role insert, and this column is
-- written on the way in with the rest of the row.
