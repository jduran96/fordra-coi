# Fordra — Project Handoff & Current State

> Operational snapshot for future sessions. For the *design rationale* and roadmap, see
> `BUILD_PLAN.md`. This file is the **what exists right now and how to run it**.

## ⏱️ START HERE (as of 2026-07-12 evening, latest commit bdfae19 — CODE FREEZE)

**Where things stand:** the owner declared code freeze at the end of the
2026-07-12 polish session. That session shipped (all deployed + prod-verified):
- **/login rework:** password-first form, divider, "Email me a sign-in link"
  popup ("Sign in via email link" modal), show/hide password toggle, helper
  texts swapped. Dakota/HaulPay users get owner-created passwords and change
  them in Settings (which already had a password section).
- **First-run welcome page** on /app (3 step cards with line icons); renders
  only while the org has zero verifications.
- **Settings tabs** (Insurance Standards / Your Organization / Password) using
  the /app/new segmented-control style.
- **Logo mark** (`components/LogoMark.tsx`) next to the wordmark on NavBar,
  login, and the marketing site header, wordmark nudged +1.5px (optical center).
- **Customer report reorder** (web + PDF): gaps → call notes → COI → submitted;
  call notes are stacked full-width entries, printable, no table.
- **Admin insurer questions:** `runExtractionPipeline` now fills the existing
  `agent_questions` column via NEW `generateInsurerQuestions` (one question per
  requirement, grounded in the extracted COI). Rendered on /admin/[id] under
  the extracted JSONs. Admin-only: /v1 serializer, customer page, and PDF never
  expose it; the frozen /demo keeps the old `generateAgentQuestions`.
  Questions exist only for verifications extracted after bdfae19 (re-run to get them).

**Owner's testing state at freeze:** end-to-end verification + report email
passed. M-series email tests passed earlier. Remaining suggested manual cases
were handed to the owner in-session (link-popup flow, password set/sign-in
round-trip, long-transcript print/PDF, per-requirement questions on re-run).
Fordra Testing AND Dakota Financial orgs were wiped clean of verification data
(rows + storage) for fresh pilot starts.

**Open items for the next session (none are blockers, but decide deliberately):**
1. **`undici` is imported directly in `lib/remote-docs.ts` but is NOT in
   `package.json`** — it resolves transitively via Next 16 (prod build is green),
   but a Next upgrade could remove it. Fix: `npm install undici` to pin it as a
   direct dep (no code change), then build-verify. Low urgency, real footgun.
2. Standing up the **e2e test suite** (owner request — see the 2026-07-12 queue
   below). Two manual security reviews this cycle each caught regressions the
   other introduced; automated coverage is the fix.
3. Optionally, a third multi-agent review over commit 73ba56f's diff to confirm
   the second-pass fixes introduced nothing new.

**Design/process notes:** all new user-facing copy needs owner approval before
push (he often supplies exact wording). No em dashes, no phone numbers in
customer copy. `/demo` is frozen. Descriptions are required on all requirement
rows; the `/v1` `rate_confirmation` field was intentionally removed (no alias).

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
  **`/auth/link`** (crawler-proof interstitial, JS auto-continue; repeat-bug #10) →
  `/auth/callback` (role-based redirect) → `/auth/signout`. ALL sign-in links (emails and
  admin-minted) must point at `/auth/link`, never raw `/auth/callback`.
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
- **Requirements are entirely org-owned** (the global baseline merge was removed by migration
  `0012`): templates and submitted standards carry the full checklist; manual mode offers two
  opt-in standard checks (policyholder-name match, policy active) pre-checked on the form.
  **The three OCR prompts (COI vision extraction, rate-con/standards text extraction,
  requirements parsing) are admin-editable at `/admin/settings`**, stored in the `app_config`
  key/value table (migration `0007`) and loaded by `getExtractionConfig()` (`lib/config.ts`);
  unset keys fall back to the `DEFAULT_*` constants in `lib/claude.ts`.
- **`/admin`** (review console): queue lists ALL verifications across orgs (source of truth):
  awaiting-review section + completed section. Admin-facing status is derived, not stored
  (`lib/admin-status.ts`): **New** (no admin action) → **In Progress** (extraction/notes/draft
  exist) → **Complete** (published), plus **Rejected** (`case_status = 'rejected'`).
  **Assessment state machine (2026-07-10):** published and rejected cases are CLOSED — the
  assessment form is read-only with a single **Edit Status** button (intent `reopen`, which
  only flips the case back to pending in the review queue and never writes `final_report`;
  the closed form's fields are disabled and absent from the submission, so parsing them
  would wipe verdicts). Save draft / Reject / Publish appear only on open cases; draft and
  reject both clear `published_at` (customers only ever see the last published assessment),
  and reject shows the customer a red Rejected pill + "rejected by a Fordra admin" notice
  (list + detail read `case_status` from the view). Detail page stacks vertically:
  **Uploads** (signed URLs) → **OCR Analysis** (Run extraction; insurer-contact card + raw
  JSON) → **Verification call notes** (append/delete via atomic RPCs
  `admin_append_call_note`/`admin_delete_call_note`, migration `0016`, service-role only —
  never read-modify-write `call_notes`; per-note two-click Delete button; failed saves keep
  the dialog open with the text) → **Assessment** (per-requirement verdict
  Passed/Discrepancy/Unconfirmed + evidence + summary). Publishing writes `final_report` in the same
  `{met, not_met, uncertain, narrative_summary}` shape the pipeline produces; the customer page
  prefers `final_report` over `gap_analysis`, so manual and automated verdicts render identically.
  `/admin/users` manages users AND orgs: invite (re-inviting an existing user mints a fresh
  sign-in link instead of erroring), per-user "Invite link" pop-up (reuses its link on reopen;
  explicit Regenerate), edit/delete users, and an Organizations table with inline rename and
  cascade delete (members, verifications, documents + storage, Slack rows; admin accounts are
  only unassigned).
- **`/v1` API**: `lib/api-auth.ts` (Bearer/Basic key), **`POST /v1/verifications`** = one multipart
  call (`carrier_name`, `broker_name`→`verifier_company`, `coi`, `additional_documents`
  repeatable ≤5 (`rate_confirmation` = legacy alias), `insurance_standards` string-or-file),
  `GET /v1/verifications` + `/:id`. **Sandbox** (`sk_test_`)
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
  rate limit bites). Humans reach it via `/auth/link`; sign-in tokens are single-use and
  last-one-wins (Email OTP Expiration is set to 24h in the dashboard; templates say 24 hours).

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

## Added 2026-07-10 (production audit + hardening)

A four-area code audit (auth/session, /app portal, /admin console, pipeline//v1) ran this
session; confirmed fixes shipped, the rest is listed under "Outstanding audit findings".

- **Publish state machine** (see the /admin section above): closed cases (published or
  rejected) are read-only with Edit Status; draft/reject unpublish; `saveAssessment` errors
  are surfaced in the form, never swallowed.
- **Call notes are race-proof** (migration `0016` RPCs) with admin-only per-note delete.
- **Rejected verifications are customer-visible**: red Rejected pill on /app list + detail,
  notice copy "This verification request was rejected by a Fordra admin. Contact us to learn
  more." (exact copy is owner-approved; do not reword casually).
- **PDF download**: `/app/[id]/pdf` route (session client through `my_verifications`, so RLS
  + publish gating hold) renders `lib/report-pdf.ts` via pdfkit — kept external in
  `next.config.ts` (`serverExternalPackages`) so its runtime font files resolve.
- **Pacific timestamps**: all verification timestamps format through `lib/dates.ts`
  ("7/10/2026, 6:00 PM (Pacific US)"). Server components render in UTC on Vercel, so never
  use unpinned `toLocaleString` for display.
- **/app/new template UX**: requirements render as a read-only bulleted list + Edit modal
  (drafts validated on Apply via `normalizeRequirementRows`, which is now non-destructive on
  error — repeat-bug #11); per-deal variable inputs live in their own card and are FREE TEXT
  everywhere (legacy stored `type: 'currency'` rows are rendered as text too — never run
  variable values through `formatCurrencyInput`).
- **/auth/link is spinner-only** (no button/form): nothing on the interstitial is followable
  without executing JS.

**All audit findings above were fixed and deployed later on 2026-07-10** (auth callback
cookie hardening, POST signout on access-denied, users-page `requireAdmin`, docx/txt
extraction via mammoth/utf-8, `createVerification` compensation + sanitized storage keys,
submit prechecks + try/catch, the swallowed-error sweep — reads now throw into the branded
`app/error.tsx`, `app/not-found.tsx` handles bad ids — and the webhook overhaul: publish
payload = `serializeVerification` everywhere, timestamped signature `t=..,v1=..`, delivery
recorded on `events.attempts/delivered_at`, endpoint URL guard, migration `0017` makes
`webhook_endpoints` customer-read-only). Except:

- ~~Magic-link auto sign-in kept as-is~~ **Superseded 2026-07-11 (pre-pilot):** /auth/link
  now shows a human-click Sign in button (form GET; AutoContinue removed), so
  JS-executing mail scanners no longer consume tokens. See fordra-repeat-bugs #12.

**Pending manual test docket (owner, next session):** — expanded into the full
pre-freeze checklist in **`TEST_PLAN.md`** (2026-07-11); the six items below are
folded into it as the [docket]-tagged cases. Run TEST_PLAN.md top to bottom to
certify the code freeze.

1. Magic-link sign-in, customer and admin (regression on the callback cookie change).
2. Submit a verification with a `.docx` or `.txt` standards file, then Run extraction on
   it (this path was a guaranteed crash before; exercises new mammoth/utf-8 code).
3. Attach a file over 20MB → friendly error, no stuck spinner.
4. Visit `/app/garbage-id` → branded "Page not found".
5. Non-admin visits /admin → access-denied → Sign out button actually signs out.
6. Admin regression pass: queue, detail page, users page, one publish.

## Added 2026-07-11 (freeze-week test round fixes)

Full pre-freeze checklist: `TEST_PLAN.md` (round 1 passed; /v1 API section machine-tested
against prod, all test rows cleaned). Changes from the owner's round-2 feedback:

- **"Any other relevant documents" replaces "Rate Confirmation Sheet"** on /app/new:
  new `MultiDropZone` (components/UploadCards.tsx, demo's single-file DropZone untouched),
  **up to 5 files**, stored under the legacy `rcs` document kind; `createVerification`
  de-collides same-name storage keys. **`rcs` docs are NOT OCR'd or parsed into
  requirements** (owner decision 2026-07-11: unlike the old rate-con slot, arbitrary
  attachments must not contaminate the deal's requirements; revisit once real usage is
  seen). Customer detail labels the group "Other documents"; admin uploads label them
  "Other", and the admin Insurance standards card shows provenance (Template: <name> /
  Entered as text) but is hidden for uploaded-doc standards. `/v1` accepts repeatable
  `additional_documents` (up to 5) with `rate_confirmation` kept as a silent legacy alias;
  /app/docs updated.
- **No phone numbers in customer-facing copy** (docs page, PDF footer; the no-org screen
  was already generic). Convention recorded here and in AGENTS.md.
- **Invite/edit users without an org:** both modals gained a "No organization" option
  (`org_id = 'none'` → NULL); a no-org user sees the "contact a Fordra admin" screen.
- **not-found copy:** "Does not exist or extra permissions required. Contact a Fordra
  admin for help." (owner-approved copy.)
- **RequirementsEditor Description column** placeholder now says "Optional" (notes were
  never required by `normalizeRequirementRows`, for any row kind).
- **Direct-to-storage uploads on /app/new (2026-07-11, round-3 build).** Vercel hard-caps
  function request bodies at ~4.5MB (raw 413 `FUNCTION_PAYLOAD_TOO_LARGE`), so file bytes
  no longer ride the submit action: `prepareUploads` (app/app/actions.ts) mints signed
  upload URLs under `<org>/incoming/<batch>/`, the browser `uploadToSignedUrl`s each file,
  and `submitVerification` receives only storage paths — it then re-verifies every object
  server-side (org-prefix ownership, magic-byte sniff + true size via
  `statStoredObject`'s range fetch, per-slot caps) before `createVerification` records
  them via `existingStoragePath`. **Size limits (owner decision): every document 10MB
  max** — matching the bucket's own `file_size_limit`, no bucket change needed — plus a
  50MB TOTAL for other documents (`UPLOAD_MAX_BYTES`/`OTHER_DOCS_*` in
  lib/upload-validation.ts; raise the bucket limit first if these ever grow past 10MB).
  Gotchas: `statStoredObject` must use the `/object/authenticated/` storage endpoint (the
  bare `/object/` path 400s for service GETs); the bucket enforces an allowed-mime list,
  so uploads must carry a real content type; abandoned `incoming/` objects are orphans
  (cleanup task, backlog). `/v1` and /demo still send multipart and are therefore
  still subject to the ~4.5MB platform cap (documented on /app/docs; two-step upload API
  is backlog).
- **Descriptions are required on every requirement row (2026-07-11):**
  `normalizeRequirementRows` errors (non-destructively, repeat-bug #11 contract) on any
  row with empty notes — a description-less condition made VRF-1043 unparseable. Manual
  mode enforces the same at submit. `STARTER_REQUIREMENTS` now ship with editable default
  descriptions. Editor placeholder says "Required".
- **Closed cases lock call notes too:** Log-a-call and per-note Delete are hidden and the
  actions server-guarded (`caseClosed`) on published/rejected cases until Edit Status
  reopens them.
- **docx/txt accepted in the "Any other relevant documents" slot** (web + /v1 + Slack;
  `UPLOAD_ALLOW.rcs`), and Slack caps other-docs at 5 per verification.
- **/v1 accepts document LINKS (2026-07-11):** `coi`, `insurance_standards`, and
  `additional_documents` each take an attached file OR an https URL —
  `lib/remote-docs.ts` downloads it server-side (dodging the ~4.5MB body cap; one-call
  UX preserved for big files), with the same SSRF host guard as webhooks, then the bytes
  run through the normal validateUpload sniff/caps. An `insurance_standards` string
  starting with http(s):// is treated as a link, anything else as free text. Documented
  in the /app/docs "Sending documents" subsection (+ Toc entry). Smoke-tested locally:
  link submit 201, 404/html/oversize links produce clean 4xx JSON.
- **Website copy (2026-07-11, owner-authored):** hero subtext, "See a demo" button
  removed, "Fordra in Action" section title, Check/Track/Automate card subtexts, CTA
  band ("Don't waste your time on phone tag." / "Get AI to chase insurers.").
- **New-submission email alerts (2026-07-11):** `createVerification` fires
  `notifyNewVerification` (lib/notify.ts, Resend REST API) on every non-sandbox
  submission — web, /v1, and Slack. Recipients are admin-configured at
  /admin/settings ("New-submission email alerts", app_config key
  `notification_emails`, comma-separated); unset falls back to
  jullianalfonso96@gmail.com. **Requires `RESEND_API_KEY` env** (plus optional
  `NOTIFY_EMAIL_FROM`, default "Fordra <notifications@fordra.com>") in Vercel AND
  .env.local; when missing the alert logs and skips, never failing the submission.

**2026-07-12 second security pass (commit 73ba56f, deployed):** a re-review of
the day's diff caught 8 more issues, including 2 regressions from the first
pass. Fixed + verified live: the `in`-against-object kind check (prototype keys
like "toString" passed and 500-crashed the submit) → explicit KINDS list; the
IPv6 hex-mapped SSRF bypass (`::ffff:a9fe:a9fe` = 169.254.169.254 slipped the
guard) → parse hex-form mapped v4; DNS-rebinding TOCTOU → resolve once and PIN
the connection to that IP via an undici Agent (TLS still validates against the
hostname, so presigned https links keep working — live-tested with a real PDF);
reject `?`/`#`/whitespace in storage paths; clean up orphaned uploads on every
early return; require a 206 + parseable size in statStoredObject; defer the
new-submission email via `after()` (was up to 8s of inline submit latency + a
double-submit risk); 50MB aggregate cap on `/v1` additional_documents. Kept by
owner decision: descriptions required on all rows, `rate_confirmation` stays
removed. `lib/remote-docs.ts` now depends on `undici` (Node runtime, /v1 only).

**2026-07-11 late-night security pass (commit 20159c8, deployed):** a 27-agent
code review of the day's diff found 10 confirmed bugs; 8 fixed and shipped —
path-traversal cross-tenant read + cross-org deletion in `submitVerification`
(paths now ownership-checked before any read/delete), gap-analysis re-bucket that
could downgrade a failing check to passing (now takes the most-severe of
placement vs status), SSRF in `lib/remote-docs.ts` (DNS-resolves and rejects
private IPs, guards each redirect hop, streams with a byte cap), URL-shaped
standards text no longer fetched as a doc, `/v1` downloads parallelized +
maxDuration 120, alert-email HTML escaping, and the /app/new template error is
now surfaced. API-surface fixes verified live against prod (SSRF rejects,
text-vs-link, link submit, errors, auth) with test data cleaned up. NOT
browser-verified (Chrome MCP extension was offline): the web-path fixes
(traversal/cross-org/template-error) are logic-tested + deployed but want a
manual /app/new click-through. Finding #6 (rate_confirmation field removed) is
the owner's earlier decision, left as-is.

**2026-07-12 queue (owner-scheduled, calendar reminder set):**

1. M-series email-alert tests (M1-M6 in TEST_PLAN.md) — the last gate before
   tagging `freeze-2026-07-w2`.
2. **Standard e2e test setup** (owner request 2026-07-11): a repeatable automated
   suite so the agent can exercise the app itself, no owner clicking. Plan:
   Playwright against localhost (`npm run dev`), auth bootstrapped by minting a
   token_hash sign-in link with the service key (repeat-bugs #1 documents the
   admin generate_link recipe), fixtures from TEST_PLAN's docket (submit via
   template/manual/upload, big file, publish gating, closed-case lock, cross-org
   404), a dedicated seeded test org torn down after each run (shared prod DB —
   cleanup is mandatory). Complemented by agent-driven exploratory passes via the
   Chrome MCP tools. Test-only code; agree whether it lands during freeze week
   (tests don't touch app code) or after.

**Backlog test queue (post-freeze or as time allows):**

1. D8 webhook delivery (register a receiver, verify `t=..,v1=..` HMAC, `events.delivered_at`).
2. D6 cross-org key isolation against a real second-org verification id.
3. Revoked-key 401 (revoke the round-2 test keys when done — they were shared in chat).
4. `additional_documents` multi-file via API + multi-doc web submission end-to-end
   (upload 2-3 docs, admin sees all, extraction ingests all) — added 2026-07-11, deploy first.
5. Rate-limit recovery + oversize behavior re-check after the 4.5MB decision lands.

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
- **No em dashes in user-facing copy** (treated as AI-slop tells). **No phone numbers in
  customer-facing copy** (2026-07-11): say "contact/ask a Fordra admin". The (727) 729-9594
  number remains only inside the frozen /demo surface.
- Test data against the live DB must be **cleaned up** afterward (mint key → exercise → delete rows
  + storage objects). Storage rows can't be deleted via SQL; use the Storage API.
- `npx tsc --noEmit` to typecheck; ignore stale `.next/types/*` errors after deleting routes (they
  regenerate). `npx next build` for a full check.
