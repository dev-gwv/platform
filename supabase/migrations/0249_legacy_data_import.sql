-- 0249: the old app's data comes over, and its people keep their passwords.
--
-- 0218 brought the old app's subscriber list across; its projects, clients,
-- money, team and leads stayed behind. tools/legacy-import loads them, one
-- studio at a time, and records here what happened to every old studio:
--
--   * legacy_imports -- one row per old studio: imported (a new studio made
--     with the old id), merged (into the studio its owner already made here),
--     skipped_empty (nothing in it worth bringing; kept so nobody forgets it)
--     or failed (with the error, so it can be fixed and run again).
--   * legacy_logins -- logins the import made for the old app's people. Their
--     password still lives in the old app's Firebase project, so /auth/login
--     asks Firebase once, and on a match saves the password here as our own
--     hash and deletes the row. Nobody is asked to reset anything.
--
-- Both are service-only: they carry outsiders' emails.

create table if not exists legacy_imports (
  old_company_id  uuid primary key,
  company_id      uuid references companies (id) on delete set null,
  studio_name     text not null,
  status          text not null check (status in ('imported', 'merged', 'skipped_empty', 'failed')),
  detail          jsonb not null default '{}'::jsonb,   -- row counts, or the error
  imported_at     timestamptz not null default now()
);
create index if not exists legacy_imports_status_idx on legacy_imports (status);

alter table legacy_imports enable row level security;
revoke all on legacy_imports from public, anon, authenticated;
grant select, insert, update, delete on legacy_imports to service_role;

create table if not exists legacy_logins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now()
);

alter table legacy_logins enable row level security;
revoke all on legacy_logins from public, anon, authenticated;
grant select, insert, update, delete on legacy_logins to service_role;
