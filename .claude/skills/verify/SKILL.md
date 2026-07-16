---
name: verify
description: How to run and drive the Fordra app locally to verify a change end-to-end (dev server, admin/customer sessions, test rows, cleanup).
---

# Verifying Fordra changes on localhost

## Run

- A dev server is usually ALREADY RUNNING on port 3000 (`next dev` from this
  directory, often left up by the owner or another session). Check before
  starting one: `npm run dev` will fall back to 3001 and refuse if 3000 is
  serving this same dir. Turbopack hot-reloads file edits, so the running
  server picks up changes without a restart.
- Env comes from `.env.local` (loaded by the dev script and by
  `scripts/migrate.mjs`). Migrations: `npm run db:migrate` — re-applies EVERY
  file on every run, so migrations must be idempotent.

## Drive

- Use the Chrome browser tools. The owner's Chrome typically has live
  sessions for BOTH surfaces: `/admin` (admin, ADMIN_EMAIL gate) and `/app`
  (customer portal, member of the "Fordra Testing" org). Just navigate to
  `http://localhost:3000/admin` or `/app` — no login flow needed. If the
  session is missing, magic-link email only reaches the project owner; stop
  and ask rather than trying to authenticate.
- `curl` has no session: protected routes 307-redirect to login. Probe
  authenticated routes from the browser tab, not curl.

## Test data

- Create test rows directly in Supabase Postgres (connection string
  `SUPABASE_DB_URL` in `.env.local`; use node + `pg`, `ssl: { rejectUnauthorized: false }`).
- Minimal verification insert: only `org_id` and `carrier_name` are required
  (everything else has defaults). Use the "Fordra Testing" org
  (`53027574-7c10-4f86-a0e7-6fa76f7453ca`) so the customer portal session can
  see the row, and put "TEST ... (delete me)" in `carrier_name`.
- ALWAYS delete test rows (and any storage objects) when done — this is the
  live shared DB (prod points at the same database).
