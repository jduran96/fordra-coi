# Fordra — Project Handoff & Current State

> Operational snapshot for future sessions. For the *design rationale* and roadmap, see
> `BUILD_PLAN.md`. This file is the **what exists right now and how to run it**.

---

## ⚠️ PENDING TESTS — Slack + auth/login (updated 2026-07-09)

All 2026-07-08 UI cases are done: standards/new-verification UI, template extras, org/user
modals, email templates, admin review without global baseline, and the standards-editor prod
smoke test all passed by 2026-07-09 evening. Remaining before design partners onboard:

1. **Slack intake, against prod** (walkthrough: `Slack/README.md`):
   - Generate an install link from `/admin/slack` for a test org and install into a personal
     workspace. Also try an expired/tampered link (must be rejected).
   - Happy path DM: COI upload → carrier name → requirements as pasted text → `done` → shows
     as New in `/admin` under the right org and in that org's portal history.
   - Variants: requirements as a file; rate confirmation attached up front; **template by name
     with variable collection** (interacts with the reworked templates code); `cancel` mid-flow
     then restart. Read the bot copy end to end (tone, typos, no em dashes).
   - Adversarial: non-whitelisted user gets the reply with their Slack ID; revoke from
     `/admin/slack` kills the bot instantly. Watch for duplicate verifications (dedup via
     `slack_events_seen`).
2. **Auth/login:**
   - Fresh admin-invite flow end to end, opening the email **in Gmail** (repeat-bugs #1/#9
     territory). Also a customer self-invite from `/app/settings` Team.
   - Magic-link login at `/login` (customer) and `/admin/login` (admin) on prod; an org-less
     user sees the "contact admin (727) 729-9594" screen, not an error.
3. **Quick check of the 2026-07-09 polish batch** (this deploy): manual-entry row heights on
   `/app/new`; no Condition chip on customer results; "Used template: X" / "Entered manually"
   provenance in What you submitted; admin "Log a call" pop-up saves into the notes table.

One cross-surface pass: one Slack-originated and one web-originated verification through
review → extraction → publish → identical rendering on the portal.

Clean up any test rows/users/storage afterwards, including `slack-intake/...` temp objects and
intake sessions (or ask the agent to). Delete this section when done.

---

## What this app is

**Fordra** is a COI (Certificate of Insurance) verification platform for freight factoring
companies. A factor's broker submits a carrier's insurance documents; Fordra extracts and checks
them against the deal's requirements, a human reviews, and the verdict is returned.

It ships as **one Next.js app + one Supabase backend**, with **five surfaces** behind four
different auth mechanisms, plus a **separate static marketing site**.

| Surface | Path | Who | Auth |
|---|---|---|---|
| Marketing site | `fordra.com` (static, separate repo dir) | Public | none |
| Demo | `/demo` | Sales / Jullian | **Password gate** (`APP_PASSWORD`); session cookie, token hard-expires after 24h (`lib/demo-token.ts`) |
| Customer portal | `/app` | Customers (e.g. HaulPay) | **Supabase magic-link or password** at `/login` (RLS-scoped); invite-only, no self-signup |
| Admin console | `/admin` | Jullian + Emmanuel | **Supabase magic-link only** at `/admin/login`, gated to the `ADMIN_EMAIL` comma-separated allowlist |
| Machine API | `/v1/*` | Customer systems | **API keys** (`sk_test_`/`sk_live_`) |
| Slack intake | `/api/slack/*` | Partner Slack workspaces | **Signed install links + Slack signing secret** (see `Slack/README.md`) |

The landing chooser is the marketing site's nav: **Demo / Admin / App** links point at
`app.fordra.com/{demo,admin,}` in production, and auto-rewrite to `localhost:3000` when viewed
locally. The Next app root `/` redirects to `/app`.

---

## Tech stack

- **Next.js 16.2.6** (App Router, Turbopack), **React 19**. ⚠️ Next 16 renames `middleware` →
  **`proxy.ts`**; APIs differ from training data — read `node_modules/next/dist/docs/` before
  writing Next code.
- **Supabase**: Auth (Google + email magic link; only magic link is used), Postgres (+ RLS),
  Storage (private `documents` bucket). Project ref `nkmhzkwqzbfzwtrzqpsa`.
- **Anthropic Claude** (`claude-sonnet-4-6`) for OCR/extraction + gap analysis.
- **Retell** for the demo's AI phone-call step.
- **sharp** for image downscaling; **pg** for migrations; **Vercel** for deploy.

---

## Two critical local-dev gotchas

1. **Node TLS corrupts large uploads to Anthropic on this machine.** Every Node version (22/25/26)
   intermittently fails with `ERR_SSL_..._BAD_RECORD_MAC` on large HTTPS bodies; the system curl is
   reliable. **Workarounds already in place:**
   - `lib/anthropic-fetch.ts` routes the Claude SDK through system `curl` in local dev
     (`opts.fetch = curlFetch` when `!process.env.VERCEL`); production uses native fetch.
   - `app/api/verify/route.ts` downscales images with sharp (≤1568px, JPEG 80) before sending,
     keeping payloads small. **If a large PDF still fails, add PDF rasterization** (sharp can't).
   Don't "fix" these by reverting them — they're load-bearing on this machine.

2. ~~Magic-link email only delivers to the project owner~~ **Resolved 2026-07-08:** custom SMTP
   (Resend, smtp.resend.com:465) is configured in Supabase Auth, and the Magic Link + Invite
   email templates use the `token_hash` link format (repo copies: `supabase/email-templates/`;
   see `.claude/skills/fordra-repeat-bugs/SKILL.md` #1 — a template reset to the PKCE default
   reintroduces the "link bounces back to login" bug).

Also: `next.config.ts` sets `experimental.proxyClientMaxBodySize: '30mb'` (the proxy buffers the
body with a 10MB cap by default, which broke multipart uploads).

---

## How to run locally

```bash
# 1. App (port 3000) — dev script sources .env.local
cd fordra-coi-app && npm run dev

# 2. Marketing site (port 8080) — its nav rewrites links to localhost:3000
cd website && python3 -m http.server 8080 --bind 127.0.0.1

# 3. DB migrations (idempotent) — needs SUPABASE_DB_URL in .env.local
npm run db:migrate
```

Entry points: app at **http://localhost:3000**, marketing site at **http://localhost:8080**.

**Required `.env.local`** keys: `ANTHROPIC_API_KEY`, `RETELL_*`, `APP_PASSWORD`, `SESSION_SECRET`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`sb_publishable_…`),
`SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_…`), `ADMIN_EMAIL`, `SUPABASE_DB_URL` (Postgres session-pooler
connection string, used only by migrations). `POSTGRES_URL` points at a **separate Prisma DB used by
the legacy demo** — do not confuse it with Supabase.

---

## Data model (Supabase, `supabase/migrations/`)

Tenant = **`orgs`** (NOT "partners" — the BUILD_PLAN prose predates this; orgs is authoritative).

- `orgs` — the factoring customer. `profiles` — extends `auth.users` with `role` (`customer|admin`)
  + `org_id`. `current_org()` / `is_admin()` SQL helpers; `handle_new_user()` trigger auto-creates a
  profile (admin if email = the hardcoded `jullianalfonso96@gmail.com`).
- `api_keys` (hashed, `sk_test_`/`sk_live_`), `documents` (kind `coi|rcs|requirements`, with
  extraction columns `raw_ocr/extracted/confidence/extractor/extraction_status`), `verifications`,
  `webhook_endpoints`, `events`, `monitors`.
- **Verification status is two-level:** `status` = `ui_status` (`pending|completed|error`,
  customer-facing) + `case_status` (internal pipeline enum). **Publish gating:** the
  `my_verifications` **view** hides analysis fields until `published_at` is set by admin — that's how
  the admin "releases" a result to the customer.
- **RLS** isolates everything by `org_id`; admin sees all via `is_admin()`. The `/v1` API uses the
  **service-role** client and scopes by the key's `org_id` in code.
- ⚠️ **Column-level grants on `verifications`:** besides the view, gating is enforced by granting
  `authenticated` SELECT on only 17 of 27 columns (analysis fields like `coi_extracted`,
  `gap_analysis`, `final_report` excluded). Postgres grants are per-role, so this hits the admin's
  session too: `select('*')` via the session client fails with `permission denied` (this once
  surfaced as a 500 on the admin detail page and can surface as a silently empty queue). All
  `/admin` pages + actions therefore use `createServiceClient()` after `requireAdmin()`.

Migrations: `0001` (Phase A additions on top of the pre-existing dashboard schema), `0002`
(api_keys customer write), `0003` (nullable `verification_id`/`created_by` for API rows), `0004`
(`auto_call` column + PostgREST cache reload), `0009` (Slack: `slack_installations`,
`slack_intake_sessions`, `slack_events_seen` — all service-role only).

**Slack intake** (`Slack/` folder — plumbing, conversation state machine, manifest, README; the
route files under `app/api/slack/` are thin re-exports). Partners DM the Fordra Slack app a COI,
the bot collects carrier name + requirements conversationally, then calls the shared
`createVerification()` in `lib/verifications.ts` (also used by the web action and `/v1`).
Gatekeeping: installs only work via HMAC-signed per-org links generated on `/admin/slack`
(signed with `SESSION_SECRET`); runtime events verified with `SLACK_SIGNING_SECRET` + active
`slack_installations` row; optional per-user whitelist. Env: `SLACK_CLIENT_ID`,
`SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`. Setup + testing walkthrough: `Slack/README.md`.

---

## What's built (Phase A — the pilot)

- **Auth/routing**: `proxy.ts` routes the 3 browser surfaces + passes `/v1` through;
  `lib/supabase/{server,client,proxy}.ts`, `lib/auth-helpers.ts`; `/login` magic link →
  `/auth/callback` (role-based redirect) → `/auth/signout`.
- **`/demo`**: the original operator pipeline (`app/demo/AppClient.tsx`, ~1800 lines) behind the
  password gate at `/demo/login`. Upload screen collects Broker, Carrier, COI, **Rate Confirmation
  Sheet** (required), and **Additional Insurance Standards** (file or manual rows). `/api/verify`
  downsizes images, extracts COI + parses requirements (incl. rate-con text) → gap analysis →
  optional Retell call → Preliminary/Final report. Reports have no subtitle; the final summary
  includes the policyholder-name check.
- **`/app`** (customer portal): nav = **Verifications** + **API Docs**. Verifications = history
  table + "New verification" button; first-time users (no org) see a "contact admin (727) 729-9594"
  screen. `/app/new` = manual upload. **API Docs** = admin-provisioned-key notice + hand-written
  docs (single multipart `Start a Verification` call, `Get Result` via webhook/GET, sandbox).
- **Sessions expire after 24h everywhere:** the demo gate token carries a signed issued-at
  (`lib/demo-token.ts`), and the proxy rejects Supabase sessions on `/app` + `/admin` once
  `user.last_sign_in_at` is older than 24h (redirect to `/login?expired=1`, sb-cookies cleared).
- **Gap analysis always includes baseline broker checks** (`baselineRequirements()` in
  `lib/claude.ts`): policyholder-name match, policy currently active, no unusual exclusions —
  merged with the stated requirements when the admin runs extraction, even if no
  insurance-standards doc was provided. **Both the baseline list and the three OCR prompts
  (COI vision extraction, rate-con/standards text extraction, requirements parsing) are
  admin-editable at `/admin/configs`**, stored in the `app_config` key/value table (migration
  `0007`) and loaded by `getExtractionConfig()` (`lib/config.ts`); unset keys fall back to the
  `DEFAULT_*` constants in `lib/claude.ts`. Baseline criteria may use `{carrier_name}`.
- **`/admin`** (review console): queue lists ALL verifications across orgs (source of truth):
  awaiting-review section + completed section. Admin-facing status is derived, not stored
  (`lib/admin-status.ts`): **New** (no admin action) → **In Progress** (extraction/notes/draft
  exist) → **Complete** (published). Detail page stacks vertically: **Uploads** (signed URLs) →
  **OCR Analysis** (Run extraction; insurer-contact card + raw JSON) → **Verification call notes**
  (`call_notes` is an append-only jsonb array of `{at, text}`; insurer contact saved alongside) →
  **Assessment** (per-requirement verdict Passed/Discrepancy/Unconfirmed + evidence + summary;
  Save draft or Publish). Publishing writes `final_report` in the same
  `{met, not_met, uncertain, narrative_summary}` shape the pipeline produces; the customer page
  prefers `final_report` over `gap_analysis`, so manual and automated verdicts render identically.
  `/admin/users` links a signup to an org.
- **`/v1` API**: `lib/api-auth.ts` (Bearer/Basic key), **`POST /v1/verifications`** = one multipart
  call (`carrier_name`, `broker_name`→`verifier_company`, `coi`, `rate_confirmation`,
  `insurance_standards` string-or-file), `GET /v1/verifications` + `/:id`. **Sandbox** (`sk_test_`)
  auto-completes with a canned result + fires the webhook. `lib/webhooks.ts` (HMAC delivery),
  `lib/storage.ts`, `lib/apikeys.ts`.

---

## Deployment (live since 2026-07-05)

Both surfaces auto-deploy from GitHub (`jduran96/fordra-coi`, one repo, two Vercel projects):

- **app.fordra.com** ← Vercel project `fordra-coi-app`, production branch **`main`** (this repo dir).
- **fordra.com** ← Vercel project `fordra-coi-website`, production branch **`main`**, Root
  Directory **`website/`** (monorepo since 2026-07-08; the old `website` branch and the separate
  `../fordra-coi-website` clone are retired).
- Push = deploy. No CLI steps needed; `npx vercel` is authenticated on this machine if manual
  deploys are ever required.
- Vercel env is complete (incl. `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`). A stray
  `SUPABASE_SECRET_KEY` var duplicates the service key under the wrong name; unused, deletable.
- Supabase Auth URL config: Site URL `https://app.fordra.com`; redirect allowlist includes the
  prod and `localhost:3000` callbacks, so magic-link login works in both environments.
- **Prod and local dev share the same Supabase project** — migrations apply once, data is common.
- `/auth/callback` accepts both PKCE `?code=` links (login page emails) and `?token_hash=&type=`
  links (`auth.admin.generateLink`, used to mint direct sign-in links when the built-in mailer's
  rate limit bites).

---

## Added 2026-07-08 (Dakota pilot readiness)

- **Requirement templates (self-serve insurance standards):** `requirement_templates` table
  (migration `0011`, org-scoped RLS CRUD for `authenticated`), `lib/templates.ts`
  (`resolveTemplate` substitutes `{tokens}`; `{carrier_name}` auto-fills from the carrier field,
  other tokens become per-deal form inputs, e.g. `{asset_sale_price}`). Managed on **/app/settings**
  (new nav item; also has a Team section w/ self-invites). The web form pre-selects the org's
  default template with swap/manual/upload fallbacks; `/v1` accepts `template_id`/`template_name`
  + `template_variables` (+ `GET /v1/templates`); Slack offers templates by name and collects
  variable values. `verifications.template_id` records provenance; template-based submissions
  skip the global baseline merge (templates pre-fill baseline rows in the Settings editor).
- **Extraction upgrades:** `COIExtracted` gains `loss_payee` + `other_named_parties` (+ per-coverage
  `additional_insured`/`loss_payee`); the OCR prompt searches the whole doc for owner-operator
  names; the policyholder baseline treats a carrier found elsewhere on the cert as `uncertain`.
  Pipeline body moved to `lib/extraction.ts`; `/admin/[id]` exports `maxDuration = 300`.
- **Invites:** admin Invite User modal on /admin/users (`inviteUser` + copy-able one-time link);
  customer self-invite on /app/settings (own org only). Auth emails are branded
  (`supabase/email-templates/`).
- **Monorepo:** the marketing site moved into `website/` (Vercel `fordra-coi-website` project:
  production branch `main`, root directory `website/`). Redundant Vercel project `fordra` and
  the stray `SUPABASE_SECRET_KEY` env var were deleted.
- **Known-bug checklist:** `.claude/skills/fordra-repeat-bugs/SKILL.md` — consult before
  debugging auth/empty-page/extraction issues; append new recurring bugs there.

## Deferred (not built yet)

- **Google OAuth** (magic-link-only for now).
- **Phase B**: rate-con inference extractor (stated + inferred requirements with explanations),
  Middesk-shaped `review_tasks`/`requirements_normalized` in the real pipeline (the pilot reuses
  `coi_extracted`/`gap_analysis`).
- **Azure Document Intelligence** as a swappable stage-1 OCR layer (`Extractor` interface) — Phase C.
- **Self-serve webhook registration** (`POST /v1/webhooks`); webhook **retries/backoff**.
- **Document reuse** across verifications (deliberately removed; each submission is self-contained).

---

## Working conventions

- **Design system:** the Krida-inspired system documented in `website/HANDOFF.md`
  §3–§5 is canonical for both repos (cream paper / near-black ink / electric lime accent,
  Newsreader + Hanken Grotesk + JetBrains Mono, pill buttons, soft rounded cards, mono eyebrows).
  The app mirrors it in `lib/theme.ts` (`C`); UI uses inline styles with that palette. No Tailwind
  classes in the new surfaces. Apply this system to any new UI without being asked.
- **No em dashes in user-facing copy** (treated as AI-slop tells). Contact number used throughout:
  **(727) 729-9594**.
- Test data against the live DB must be **cleaned up** afterward (mint key → exercise → delete rows
  + storage objects). Storage rows can't be deleted via SQL; use the Storage API.
- `npx tsc --noEmit` to typecheck; ignore stale `.next/types/*` errors after deleting routes (they
  regenerate). `npx next build` for a full check.
