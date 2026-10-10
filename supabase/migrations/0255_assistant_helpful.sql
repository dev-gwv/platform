-- 0255: was the assistant's answer any use?
--
-- 0247 logs every question and what came back, but nothing in that row says
-- whether the answer actually helped. Status is not quality: an answer can be
-- fluent, well-sourced, logged as 'answered' and still be wrong, and the only
-- person who knows is the studio owner reading it.
--
-- So the answer carries a thumb. null means nobody said (which is most of them,
-- and is not the same as "no"); true and false are the only real signal we have
-- about whether the knowledge base is working, and the thing to read before
-- rewriting a prompt on a hunch.
--
-- The table stays service-only, exactly as 0247 left it: a studio never reads
-- the log, and the platform admin reads it through the API.

alter table assistant_log
  add column if not exists helpful boolean;

-- Only the rows somebody answered, newest first -- the question the platform
-- console asks ("what are people marking as no use?"). Partial, because the
-- rows with no thumb are the overwhelming majority and indexing them would be
-- indexing nothing.
create index if not exists assistant_log_helpful_idx
  on assistant_log (helpful, created_at desc)
  where helpful is not null;

-- A studio marks its own answer, so the API needs to find the row it just
-- wrote: by id, scoped to the company. No new grant is needed -- service_role
-- already has select and insert from 0247 -- but it does need update, which it
-- was never given.
grant update (helpful) on assistant_log to service_role;
