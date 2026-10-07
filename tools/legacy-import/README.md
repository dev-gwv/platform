# Old app → Studio AutoPilot data import

Brings every studio's data from the old Lovable app (Supabase on Lovable Cloud, Firebase logins) into this database. 0249 records the outcome per studio (`legacy_imports`), and lets imported people sign in with their old password (`legacy_logins`, `lib/legacy-login.ts`).

## Files

| File | What it does |
| --- | --- |
| `build-load.mjs` | Turns the export folder (`tables/*.json`, `files/`) into `load.sql`: the raw rows in `legacy.src`, logos in `legacy.blobs`. It skips logs, tokens and the old app's own billing. |
| `import.sql` | All the mapping, as functions in the `legacy` schema. Running it again replaces them. |
| `local-test.mjs` | Dry run on your machine (pglite, every migration, one simulated merge). Writes `local-test-result.json`. |

`load.sql`, the export and the test result hold every studio's clients, phones and money. **Keep them out of git** and off shared drives.

## What happens to a studio

- **No data** (no clients, projects, leads, team, invoices, expenses or disks): recorded as `skipped_empty`, with its admins' emails. Nothing else is made, and the owner can still sign up fresh.
- **Owner already here.** An admin email of the old studio matches an owner or admin of a studio made on this app, or `legacy_studios.joined_company_id` points to one. The old data is merged into that studio (`merged`). Blank company fields are filled, nothing is overwritten, and a clashing invoice number gets `-OLD`.
- **Otherwise**: a new studio with the old company id (`imported`). Setup counts as done and onboarding emails are off.
- **Failure**: rolled back for that studio only and recorded as `failed` with the error. Fix the cause and run `import_all()` again. Imported, merged and skipped studios are not touched twice.

Old ids are kept for every business row; only people get new ids (`legacy.person`).

## People and logins

- Admins and team members with a real email get a login: their email's identity here, made with no password when missing and listed in `legacy_logins`. A second studio for the same person becomes a profile row (0159).
- `offline_*` / `manual_emp_*` people, and anyone without an email, become team members with no login.
- First sign-in: `/auth/login` finds no password, checks the password with the old Firebase project (`FIREBASE_WEB_API_KEY`), then saves it here and deletes the `legacy_logins` row. Google sign-in works by email as before. Anyone else uses Forgot password.
- The old app's plain-text `shared_password` is never exported or imported.

## Run it

1. Export the old app (the `migration-export` endpoint) into a private folder, after making the old app read-only.
2. `node tools/legacy-import/build-load.mjs <exportDir> <exportDir>/load.sql`
3. Dry run locally: `bun tools/legacy-import/local-test.mjs <exportDir>/load.sql <privateOutDir>`
4. On the VPS, **first against a restored copy of last night's backup**, then for real, as `postgres`:
   ```sh
   psql -v ON_ERROR_STOP=1 -f load.sql
   psql -v ON_ERROR_STOP=1 -f import.sql
   psql -c "select legacy.import_all()"
   psql -c "select * from legacy.report where verdict = 'CHECK'"
   psql -c "select studio_name, detail from legacy_imports where status = 'failed'"
   ```
   On Coolify, run psql through `docker compose -f docker-compose.yml -f docker-compose.coolify.yml exec -T db`. **Never run a bare `docker compose up`** (see CLAUDE.md).
5. Set `FIREBASE_WEB_API_KEY` on the API and redeploy with `sh deploy/deploy.sh`.
6. When everyone has moved, `drop schema legacy cascade;` and delete the export endpoint in the old app.
