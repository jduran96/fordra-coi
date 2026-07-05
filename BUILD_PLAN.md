# Fordra — Full Build Plan (API + Customer Portal + Admin Review Queue)

## Product shape

Fordra is a COI-verification platform for freight factors, delivered as **three front-end paths
over one API and one database**:

| Path | Who | What it is | Auth |
|---|---|---|---|
| **`/demo`** | Sales / Jullian | The **existing** single-operator pipeline (upload COI + requirements → OCR → gap analysis → optional agent call → report). Untouched. | Existing **password gate** (`APP_PASSWORD` + `SESSION_SECRET`) |
| **`/app`** | **Customers** (e.g. HaulPay) | **New** customer portal: **API endpoint docs**, **manual upload flow**, their own verification queue, and API-key management. | **Supabase** (Google OAuth + email magic link), RLS-scoped to their partner |
| **`/admin`** | **Jullian only** | **New** review console: the queue of verification requests (arriving via API **or** the `/app` manual upload), where I review, call the provider, set status, and notify the partner. | **Supabase**, gated to `ADMIN_EMAIL` |
| **`/v1/*`** | Customer **systems** | The **machine API**: partners push documents + verifications programmatically and receive status by webhook or poll. | **API keys** (`sk_test_` / `sk_live_`), Basic auth |

The near-term product is the **API + the admin review queue**; `/app` gives a customer a UI
alternative to the API and a place to read the docs and get keys. **Pilot is human-review-only —
no auto-funding, no auto-decisioning** (confirmed with partner). The AI accelerants (gap-analysis
suggestions, inference, agent call) layer in behind the human, never replacing them, for the pilot.

### What already exists

- Next.js **16.2.6** / React 19, Vercel Blob + Vercel Postgres, Anthropic + Retell SDKs.
- `lib/claude.ts` (`extractCOIFields`, `parseRequirements`, `analyzeGaps`, `generateAgentQuestions`,
  `parseTranscript`, `generateFinalReport`), `lib/retell.ts`, the operator UI at `/app`
  (`AppClient.tsx`, `GapTable`, `ReportView`, `StatusBadge`), and the password-gate auth
  (`lib/auth.ts`, `lib/dal.ts`).

**The existing `/app` operator UI moves to `/demo`** (keep its password gate). The name `/app` is
reclaimed for the new customer portal.

---

## ✅ Phase A build status (implemented & verified)

Built, `next build` green, `/v1` smoke-tested end-to-end against the live DB (then test data purged):

- **Auth/routing** — `proxy.ts` routes 3 surfaces: demo password gate (`/demo`, moved from `/app`),
  Supabase magic-link sessions (`/app` + `/admin`, admin gated by `ADMIN_EMAIL`), API keys (`/v1`).
  `lib/supabase/{server,client,proxy}.ts`, `lib/auth-helpers.ts`. Login at `/login` →
  `/auth/callback`; `/auth/signout`.
- **Customer portal `/app`** — dashboard (`my_verifications`), manual upload (`/app/new`), API-key
  management (`/app/keys`), hand-written API docs (`/app/docs`), per-deal view (`/app/[id]`).
- **Admin console `/admin`** — review queue, two-pane detail (originals + signed URLs | parsed
  analysis), Run-extraction (Claude), call-notes, **Publish** (sets `published_at` → releases the
  gated view + fires `verification.updated`), mark-error, and `/admin/users` to link a signup to an org.
- **`/v1` API** — `lib/api-auth.ts` (Basic key auth), `POST /v1/documents` (multipart → storage),
  `POST/GET /v1/verifications`, `GET /v1/verifications/:id`. `lib/webhooks.ts` (HMAC delivery),
  `lib/storage.ts`, `lib/apikeys.ts`.
- **Migrations** `0001`–`0004` applied: api_keys/webhooks/events, admin RLS, extraction columns,
  `requirements_normalized`, `auto_call`, nullable `verification_id`/`created_by` for the API.

**Simplifications vs. the prose below (intentional, pilot-scoped):** extraction reuses
`lib/claude.ts` directly (no separate `Extractor` interface yet — Azure DI swap is Phase C);
review output uses the existing `coi_extracted`/`gap_analysis` (Middesk `review_tasks` is Phase B);
webhook delivery is best-effort (no retry/backoff yet).

**Needs the user (dashboard, can't be done from code):** (1) **custom SMTP** in Supabase Auth so
magic links reach non-project emails like HaulPay — until then only the project owner's email
receives links; (2) Google OAuth if ever wanted. On Vercel, the admin Run-extraction action needs
a route with `maxDuration` raised (Claude vision is slow).

---

## ⚠️ Schema reality (authoritative — supersedes naming below)

The live Supabase project already has a hand-built schema; **it is the source of truth**, and
this doc's earlier `partners`/`partner_id` naming is reconciled to it as follows:

| This doc says | Live schema actually uses |
|---|---|
| `partners` / `partner_id` | **`orgs` / `org_id`** (tenant). Helper: **`current_org()`** |
| (n/a) | **publish-gating**: customer inserts a verification `status='pending'`; the **`my_verifications` view hides all analysis** (`coi_extracted`, `gap_analysis`, `final_report`…) until **`published_at`** is set by admin. This *is* the review-queue release mechanism. |
| single `status` | two levels: **`ui_status`** (pending/completed/error, customer-facing) + **`case_status`** (internal pipeline enum) |
| `documents` doc-first | `documents` belong to a verification (`verification_id`), `kind ∈ {requirements, coi, rcs}` (`rcs` = rate con) |
| `review_tasks` / Middesk shape | pilot uses existing `coi_extracted` + `gap_analysis` + `final_report` jsonb; Middesk-shaped `review_tasks` is a Phase B evolution |

**Added in `supabase/migrations/0001_phase_a.sql`** (additive, idempotent): `api_keys`,
`webhook_endpoints`, `events`; admin RLS policies (`is_admin()` was unused); per-document
extraction columns (`raw_ocr`, `extracted`, `confidence`, `extractor`, `extraction_status`);
`verifications.requirements_normalized`. Auth: **magic-link-first for everyone (incl. admin)**;
Google OAuth optional/deferred (needs Google Cloud setup).

---

## Auth — three mechanisms, kept separate on purpose

This is the crux. Three distinct auth surfaces coexist; do not conflate them.

1. **Password gate — `/demo` only.** Unchanged. `APP_PASSWORD` + `SESSION_SECRET`, the existing
   HMAC cookie in `lib/auth.ts` / `lib/dal.ts`. Sales demos. No Supabase, no RLS.
2. **Supabase session auth — `/app` + `/admin`.** Human browser login. Two sign-in methods, both
   free, enabled together:
   - **Google OAuth** — for Google-account users (Jullian).
   - **Email magic link** — passwordless, for everyone else (HaulPay on `@haulpay.io`, not a Google
     account). Nothing to remember or reset for pilot users.
   Same auth system for both routes; **`/admin` is additionally gated to `ADMIN_EMAIL`** via
   middleware + RLS. **Row-Level Security** isolates tenants: a customer sees only their partner's
   rows; admin sees all.
3. **API-key auth — `/v1/*`.** Machine-to-machine, Basic auth with the key as username. Separate
   **sandbox** (`sk_test_`) and **live** (`sk_live_`) keys, scoped to a partner. A customer's
   API keys and their `/app` login both resolve to the **same `partner_id`** — UI submissions and
   API submissions land in one queue.

```
Browser, demo        → password cookie         → /demo
Browser, customer    → Supabase session (RLS)  → /app   (partner-scoped)
Browser, admin       → Supabase session        → /admin (ADMIN_EMAIL gate)
Machine, customer    → API key (sk_test/live)  → /v1/*  (partner-scoped)
```

`profiles.partner_id` links a human user → partner; `api_keys.partner_id` links a key → the same
partner. Both are the tenant boundary RLS enforces.

### Tech-stack change: adopt Supabase

We need Supabase Auth anyway, and it bundles Postgres + Storage with RLS, so **consolidate on
Supabase** rather than running Vercel Postgres + Vercel Blob alongside it:

- **Supabase Postgres** — replaces `@vercel/postgres`. RLS-native tenant isolation.
- **Supabase Auth** — Google OAuth + magic link.
- **Supabase Storage** — private, partner-scoped buckets + signed URLs; RLS covers files too
  (cleaner than app-layer scoping on Vercel Blob). Migrate document storage here.

Add `@supabase/supabase-js` + `@supabase/ssr`; create `lib/supabase/server.ts` and
`lib/supabase/client.ts` (server + browser clients per `@supabase/ssr`). Keep `APP_PASSWORD` /
`SESSION_SECRET` for `/demo`.

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY        # server-only, never exposed to the client
ADMIN_EMAIL=jullianalfonso96@gmail.com
DATABASE_URL                     # Supabase pooled connection string
# kept: APP_PASSWORD, SESSION_SECRET (demo), ANTHROPIC_API_KEY, RETELL_* , (later) AZURE_DI_*
```

---

## Object model

The per-deal nature pulls the verdict off the carrier; the partner is the tenant.

- **Partner** (tenant) — the factoring customer. Owns users, API keys, carriers, verifications.
- **Carrier** (durable) — identity (`name`, `mc_number`, `dot_number`) + its COI documents, reused
  across deals. **No single verdict.** ≈ Middesk Business.
- **Verification** (per-deal, transactional) — that deal's `requirements`, references to the
  carrier's in-force COIs, `status`, `review.tasks`, `requirements_normalized`. **This is the
  immutable point-in-time record** for the bank-line audit trail.
- **Document** (doc-first input) — a COI, rate con, or requirements PDF/free-text; own async
  extraction status + per-field confidence.

---

## API surface (`/v1/*`)

Auth: Basic, API key as username. Sandbox/live keys. Idempotency-Key on POSTs. Middesk-shaped
(durable central object, async resolution, `201 ≠ verified`, `review.tasks[]` with `sources[]`,
webhook envelope, monitor) — so if the partner *is* already on Middesk, we slot in; if not, the
conventions are still sound. (Partner's Middesk status is unconfirmed → mirror the conventions,
don't hard-couple to their exact event subset until we know it.)

```
POST   /v1/documents          multipart OR { url } OR { text } → { id, type, status }  (async OCR)
GET    /v1/documents/:id      raw OCR + normalized fields + per-field confidence
POST   /v1/carriers           { name, mc_number, dot_number }
GET    /v1/carriers/:id  | GET /v1/carriers
POST   /v1/verifications      THE workhorse (below) → 201 { id, status:"processing" }
GET    /v1/verifications/:id  status + review.tasks[] + requirements_normalized + coi
GET    /v1/verifications      list / filter by status (drives the admin queue)
POST   /v1/carriers/:id/monitor  | DELETE …      ongoing expiration tracking
POST   /v1/webhooks           { url, events[] }  | GET/DELETE …
```

### Workhorse call

```jsonc
POST /v1/verifications
{
  "carrier_id": "car_...",                       // or "carrier": { "name": "...", "mc_number": "..." }
  "coi": { "document_id": "doc_..." },           // or document_ids: [...], or reuse carrier's in-force COIs
  "requirements": [                              // polymorphic, merged + normalized
    { "type": "rate_confirmation", "document_id": "doc_rc1" },
    { "type": "text", "value": "must be listed as cert holder" }
  ],
  "requirement_profile_id": "rp_...",            // optional baseline (house minimums), merged under the above
  "auto_call": false                             // pilot: always false (human review)
}
→ 201 { id, status: "processing", carrier_id }   // 201 ≠ verified
```

### Lifecycle

```
processing → analyzing → in_review → completed        (failed on terminal extraction error)
  └ OCR extraction + requirements normalization run in parallel during processing→analyzing
  └ in_review = sitting in the /admin queue (always, for pilot)
```

`verification.updated` is the event the partner subscribes to. Status delivery is **both** push
(webhook) and pull (`GET`) — partner's choice at onboarding; identical payload either way.
Events: `document.processed`, `carrier.created`, `verification.created`, `verification.updated`,
`call.completed`, `coi.expiring`, `coi.expired`, `carrier.lapsed`.

### Verification object & webhook envelope

```jsonc
{ "object": "verification", "id": "ver_...", "carrier_id": "car_...", "status": "in_review",
  "coi": { /* COIExtracted + per-field confidence */ },
  "requirements_normalized": [ /* see below */ ],
  "review": { "tasks": [
    { "key": "auto_liability_limit", "category": "coverage_limit", "label": "Automobile Liability",
      "sub_label": "Meets $1,000,000 minimum", "status": "success",
      "message": "Each-occurrence $1,000,000 ≥ required $1,000,000.", "requirement_key": "auto_liability",
      "sources": [
        { "type": "requirement",     "document_id": "doc_rc1",  "snippet": "Auto Liability: $1,000,000 CSL" },
        { "type": "coi_extraction",  "document_id": "doc_coi1", "field": "coverages[0].each_occurrence_limit" }
      ] }
  ] } }

// webhook (Middesk-style envelope):
{ "object": "event", "id": "evt_...", "type": "verification.updated",
  "created_at": "2026-06-23T...", "data": { "object": { /* verification */ } } }
```

---

## Requirements — per-deal, polymorphic, extracted, **inference ships**

Requirements change by deal and arrive in four shapes (`structured` | `text` | `document` |
`rate_confirmation`), merged into one normalized set. Two extraction pipelines feed gap analysis:
`extractCOIFields` (COI) **and** the requirements-normalizer (`parseRequirements`, extended to
rate cons + free text).

**The rate con is special — the load drives requirements.** It specifies the load (commodity,
declared value, weight, temp-controlled, lanes); insurance requirements often *follow* from the
load. Extracting it yields **stated requirements** (written limits) and **load context** (from
which some are **inferred**).

**Inference ships (partner-confirmed).** They want load-driven requirements derived **and** the
reasoning shown so they review it themselves. Every inferred requirement carries `stated:false`,
`derived_from`, lower `confidence`, and a human-readable **`explanation`** — surfaced in the admin
console *and* on the verification object the partner reads. The **partner makes the final call**
on inferred lines; we make the derivation transparent and auditable.

```jsonc
"requirements_normalized": [
  { "key": "auto_liability", "min_each_occurrence": "$1,000,000", "stated": true,
    "source": { "type": "rate_confirmation", "document_id": "doc_rc1", "page": 2,
                "snippet": "Auto Liability: $1,000,000 CSL", "confidence": 0.96 } },
  { "key": "cargo", "min_limit": "$250,000", "stated": false, "derived_from": "load_value",
    "explanation": "Rate con declares a $240k load; cargo set to the next standard tier ($250k). Confirm.",
    "source": { "type": "rate_confirmation", "document_id": "doc_rc1", "page": 1,
                "snippet": "Declared value: $240,000", "confidence": 0.7 } }
]
```

Each `review.task` references which normalized requirement it checks and which COI satisfied it:
**rate con → requirement → COI → verdict**, end to end. Optional `requirement_profile_id` baseline
(house minimums) merges **under** per-deal inputs; per-deal is authoritative on conflict.

---

## Extraction / OCR — two-stage, swappable

Every submitted document is parsed so the queue shows **two layers side by side**: the
**originals + free-text** the partner submitted, and the **parsed analysis** — so I can confirm OCR
worked before acting. Research (Azure DI, Textract, Google Doc AI, Mistral OCR, Claude/GPT VLMs)
converges on **OCR/layout layer + LLM reasoning layer**, not either alone.

| Stage | Job | Best tool | Why |
|---|---|---|---|
| 1 — OCR/layout | raw text, tables, key-value, checkboxes | **Azure Document Intelligence** | ~2–4s/page, cheap at volume, **per-field confidence + bounding boxes** (feeds the "is OCR working" view + `sources[]` provenance) |
| 2 — reason/normalize/infer | raw OCR → `COIExtracted`, normalize limits, gap analysis, infer w/ explanations | **Claude** (`claude-sonnet-4-6`) | handles variable layouts (rate cons), normalizes `$1M CSL`↔`$1,000,000`, writes inference explanations |

**Ship Phase A on Claude-vision-only** (already built, one dependency). Pure VLM is slower
(~16–33s/page), pricier, weaker on per-field confidence — so **add Azure DI as stage 1 when
accuracy/cost/throughput demand it.** Build behind an **`Extractor` interface**
(`extract(doc) → { rawOcr, fields, confidence }`) with `ClaudeExtractor` now, `AzureDIExtractor`
later — a config swap, not a rewrite. Store **both** raw OCR and normalized output so you can see
*which stage* failed.

---

## Front-end paths in detail

### `/demo` — existing operator pipeline (move, don't rewrite)
Relocate the current `/app` UI here behind the existing password gate. `/api/verify`, `/api/call`,
`/api/parse-transcript`, `/api/final-report`, `/api/call-status` stay as-is — they power the demo.

### `/app` — customer portal (new, Supabase auth, partner-scoped)
For a customer (HaulPay) to self-serve. Sections:
- **Login** — Google button + "email me a login link" field (magic link).
- **API docs** — hand-written, **no AI slop**: authentication, **sandbox vs production** (two base
  URLs + `sk_test_`/`sk_live_` prefixes; sandbox returns canned extracted COIs, no real provider
  calls, webhooks still fire), a **3-curl quickstart** (`POST /v1/documents` → `POST /v1/verifications`
  → `GET …` or webhook), object reference (Verification, `review.tasks`, `requirements_normalized`
  w/ `explanation`, webhook envelope) with real example payloads. Reuse `fordra-coi-website` brand
  tokens (`tokens.css`, DM Serif Display + Inter). OpenAPI spec as source of truth.
- **API keys** — view/rotate `sk_test_`/`sk_live_` keys for their partner.
- **Manual upload flow** — a browser alternative to the API: upload COI + rate con + free-text →
  creates a verification under their `partner_id` (same queue as API submissions).
- **Their verifications** — list + detail, RLS-scoped to their partner; read-only status + results.

### `/admin` — review console (new, Supabase, `ADMIN_EMAIL` gate)
My queue — the near-term product:
- **Queue** — verifications filtered to `in_review`, oldest first; carrier, requirement source,
  task-summary chip (4✓ 1⚠ 1✗). Backed by `GET /v1/verifications?status=in_review` (admin sees all).
- **Review detail — two layers side by side.** Left: originals (COI, rate con, free-text) as-is.
  Right: parsed analysis — `COIExtracted`, `requirements_normalized` (stated/inferred badges +
  confidence + `explanation`), `review.tasks` table. Low-confidence fields flagged.
- **My manual loop:** read parsed vs original → **call the insurance provider** to verify (human
  action, captured as a `source`/note — not Retell in pilot) → set verification status + finalize
  task verdicts (Phase A from scratch; Phase B confirm/override pre-filled suggestions, each
  override → `source: human`).
- **Resolve** → `status=completed`, write final tasks, fire `verification.updated` (and it's
  available on the partner's `GET`). Also: manage authorized customers / partners.

Reuse `GapTable` (→ task table), `ReportView`, `StatusBadge` across `/admin` and `/app` detail.

---

## Data model (Supabase Postgres + RLS)

```sql
-- tenancy + auth
create type user_role as enum ('customer','admin');
create table partners ( id uuid primary key default gen_random_uuid(),
  name text not null, created_at timestamptz not null default now() );
create table profiles ( id uuid primary key references auth.users(id) on delete cascade,
  email text not null, role user_role not null default 'customer',
  partner_id uuid references partners(id), created_at timestamptz not null default now() );
create table api_keys ( id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  mode text not null check (mode in ('sandbox','live')),
  key_hash text not null, last_used_at timestamptz, revoked_at timestamptz,
  created_at timestamptz not null default now() );

-- doc-first input
create table documents ( id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  type text not null check (type in ('coi','rate_confirmation','requirements')),
  storage_path text, free_text text,                 -- partner-submitted text, shown as-is
  status text not null default 'processing',         -- processing|processed|failed
  raw_ocr jsonb, extracted jsonb, confidence jsonb,  -- stage-1 raw, stage-2 normalized, per-field conf
  extractor text,                                    -- 'claude' | 'azure_di'
  created_at timestamptz not null default now() );

-- durable identity + per-deal verdict
create table carriers ( id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id),
  name text, mc_number text, dot_number text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now() );
create table carrier_cois ( carrier_id uuid references carriers(id), document_id uuid references documents(id),
  effective_date date, expiration_date date );
create table verifications ( id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id), carrier_id uuid references carriers(id),
  status text not null default 'processing',         -- processing|analyzing|in_review|completed|failed
  requirements jsonb, requirements_normalized jsonb, requirement_profile_id uuid,
  review_tasks jsonb, source text default 'api',     -- 'api' | 'portal'
  auto_call boolean default false,
  retell_call_id text, call_transcript text, call_answers jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now() );

create table requirement_profiles ( id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id), name text, coverages jsonb );
create table webhook_endpoints ( id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id), url text, events text[], secret text,
  created_at timestamptz not null default now() );
create table events ( id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partners(id), type text, data jsonb,
  created_at timestamptz not null default now() );
create table monitors ( id uuid primary key default gen_random_uuid(),
  carrier_id uuid references carriers(id), active boolean default true );
```

**RLS (explicit policies):**
- `profiles`: user reads own row; admin (`email = ADMIN_EMAIL`) reads/writes all.
- `partners`, `api_keys`, `webhook_endpoints`, `requirement_profiles`: customer scoped to own
  `partner_id`; admin all.
- `carriers`, `documents`, `verifications`, `carrier_cois`, `events`, `monitors`: customer CRUDs
  rows where `partner_id` = their profile's `partner_id`; admin all.
- The `/v1` API runs **server-side with the service role**, scoping to the key's `partner_id` in
  code (RLS is the browser-session guard; the API key resolves the partner explicitly).

`lib/types.ts`: keep `COIExtracted`/`COICoverage`; rename `GapItem`→`ReviewTask` (+ `key`,
`category`, `label`, `sub_label`, `status: success|warning|failure|neutral`, `message`, `sources[]`,
`requirement_key`); add `NormalizedRequirement` (`stated`, `derived_from`, `explanation`, `source`),
`Partner`, `Carrier`, `Verification`, `Document`, `Profile`. Retire `CaseStatus`/`VerificationCase`.

---

## Phasing (pilot = human-review-only)

**Phase A — Foundation + manual queue + portal.**
Supabase adoption (Auth + Postgres + Storage + RLS); move existing `/app` → `/demo`. API-key auth.
`Extractor` interface + `ClaudeExtractor`. `POST /v1/documents` (store + OCR), `POST /v1/verifications`
→ `in_review`. `/admin` queue + two-layer detail + manual resolve. `/app` portal: login, API docs
(sandbox vs prod, 3-curl quickstart), API-key management, manual upload, their queue. Webhook +
poll delivery of `verification.updated`. *No auto-decisioning, no Retell.* **This is the pilot.**

**Phase B — Assisted gap analysis (human-in-the-loop).**
`analyzeGaps` + the **rate-con extractor** (stated + inferred + `explanation`) → `review.tasks`
arrive **pre-filled as suggestions**; `requirements_normalized` carries inferred lines for partner
review. Admin confirms/overrides (→ `source: human`). Per-field confidence drives flagging.

**Phase C — Scale + optional automation (post-pilot).**
`AzureDIExtractor` swap for confidence/bbox/cost at volume. Monitor + `coi.expiring`/`lapsed`.
*Only if the partner later wants it:* a **Policies** layer (auto-complete clean verifications,
humans see exceptions) and Retell as opt-in `auto_call` for `neutral` tasks. **Not in pilot** —
partner does not auto-fund.

---

## Build order

```
 1. Supabase: project, Auth (Google + magic link), Storage buckets, DATABASE_URL
 2. lib/supabase/{server,client}.ts (@supabase/ssr); env vars
 3. DB migration + RLS: partners, profiles, api_keys, documents, carriers, verifications, webhooks, events
 4. Move current /app UI → /demo (keep password gate); reclaim /app
 5. Middleware: Supabase session for /app + /admin; ADMIN_EMAIL gate for /admin; password gate stays on /demo
 6. types.ts: Partner/Carrier/Verification/Document/ReviewTask/NormalizedRequirement/Profile
 7. API-key auth (Basic, sandbox/live) → resolves partner_id; lib/api-auth.ts
 8. Extractor interface + ClaudeExtractor (raw_ocr + normalized + confidence)
 9. POST /v1/documents (store + extract), POST /v1/verifications → in_review
10. /admin: queue + two-layer detail + manual resolve (reuse GapTable/ReportView/StatusBadge)
11. Webhook delivery (envelope, HMAC, retry) + GET poll; verification.updated
12. /app portal: login, API docs (sandbox vs prod, 3-curl), API-key mgmt, manual upload, their queue
    ── Phase A / pilot complete ──
13. analyzeGaps + rate-con extractor (inferred + explanation) → tasks-as-suggestions
14. Admin confirm/override → source:human; confidence-driven flagging
15. AzureDIExtractor swap; monitor + coi.expiring/lapsed
16. (only if partner wants) Policies auto-decision + opt-in Retell auto_call
```

## Critical files

| File | Why |
|---|---|
| `lib/supabase/server.ts` / `client.ts` (new) | Auth + RLS for `/app` + `/admin`; tenant isolation |
| `middleware.ts` (new) | Routes the 3 auth surfaces: password→/demo, Supabase→/app, ADMIN_EMAIL→/admin |
| `lib/api-auth.ts` (new) | API-key auth; resolves `partner_id` for the entire `/v1` surface |
| `lib/extractor.ts` (new) | `Extractor` interface + `ClaudeExtractor`; swap point for Azure DI |
| `lib/claude.ts` | Existing extraction; extend `parseRequirements` for rate cons + free text |
| `lib/rate-con.ts` (new) | Rate-con extractor — stated vs inferred + `explanation` |
| `lib/webhooks.ts` (new) | Envelope, HMAC, retry — partner push delivery |
| `lib/types.ts` | The unified object model everything depends on |
| `app/api/v1/verifications/route.ts` (new) | The workhorse create call |
| `app/admin/**` (new) | Review queue — the near-term product |
| `app/app/**` (new) | Customer portal: docs + manual upload + keys + their queue |
| `app/demo/**` (moved) | Existing operator pipeline, password gate, untouched logic |

---

## Open questions (status)

**Resolved:**
- **No auto-funding** — pilot is **human reviewer only**. Policies/auto-decision deferred to
  post-pilot Phase C, built only if the partner later asks.
- **Inference ships** — derive load-driven requirements **and** show `explanation` for the partner
  to review; they make the final call.
- **Status delivery** — support **both** webhook push and `GET` poll; choose per-partner.
- **Auth** — Supabase (Google + magic link) for `/app`+`/admin`, `ADMIN_EMAIL` gate on `/admin`,
  RLS tenant isolation, password gate untouched on `/demo`, API keys for `/v1`.

**Still open:**
- **Middesk?** Partner's Middesk status is unclear. We mirror Middesk conventions regardless;
  *if* they're on it, ask which objects/events they consume so we match the exact subset. No
  hard coupling until confirmed.
- **Inbound** — push to us (API/portal) vs we pull from email/portal where COIs land today.
- **Unchanged, highest-leverage:** how requirements usually arrive (rate con vs standing doc vs
  house policy), FMCSA cross-check, expiration/lapse handling, volumes, pricing
  (per-verification vs per-monitored-carrier), audit retention.

## Acceptance checks (pilot)
- Customer signs in via magic link (and Google works); **cannot** see another partner's
  verifications (RLS verified). Admin signs in (gated to `ADMIN_EMAIL`), sees all, can create a
  new authorized customer/partner.
- A `POST /v1/documents` + `POST /v1/verifications` (sandbox key) creates a verification that
  appears in `/admin` as `in_review` with originals + parsed analysis side by side.
- The same flow via the `/app` manual upload lands in the same admin queue.
- Admin resolves → partner receives `verification.updated` webhook **and** sees it on `GET`.
- `/demo` still runs the old pipeline behind the password gate, untouched.

### Sources
Middesk Quickstart / Webhooks / Review Task reference (docs.middesk.com). OCR comparison: MarkTechPost
(top-6 OCR 2025), Businessware Tech (Textract vs Azure/Google/GPT-4o), Jannik Reinhard (Azure OCR 2026),
LlamaIndex (document processing 2026).
