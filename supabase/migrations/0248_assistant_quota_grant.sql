-- 0248: let the API read the assistant's daily count.
--
-- 0247 added assistant_asked_today() and revoked it from public, anon and
-- authenticated -- correctly, since a studio has no business reading the log --
-- but never granted it to service_role, which is the only role that calls it.
-- Revoking from PUBLIC takes the default grant away from service_role too, so
-- the function existed and nothing could execute it, and the quota check would
-- have failed closed on the first question asked.
--
-- A separate migration rather than a correction to 0247 because 0247 is already
-- applied: an edited file is never re-run, so the grant would have been missing
-- exactly where it matters.

grant execute on function assistant_asked_today(uuid) to service_role;
