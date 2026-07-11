<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Fordra — agent context

**Read `HANDOFF.md` first** (current state, how to run, gotchas), then `BUILD_PLAN.md` (design
rationale + roadmap). Quick orientation:

- **What it is:** a COI verification platform. One Next.js 16 app + Supabase. Four surfaces:
  `/demo` (operator pipeline, password gate), `/app` (customer portal, Supabase magic-link),
  `/admin` (review console, gated to `ADMIN_EMAIL`), `/v1/*` (machine API, `sk_test_`/`sk_live_`
  keys). The static marketing site lives in `website/` (same folder, separate Vercel deploy).
- **Tenant = `orgs`/`org_id`** in the live Supabase schema (the term "partners" in older BUILD_PLAN
  prose is the same thing; orgs is authoritative). RLS isolates by org; admin sees all.
  `my_verifications` view hides analysis until `published_at` (the admin "publish" step).
- **Key invariants** (details in HANDOFF.md): sessions hard-expire after 24h on all three browser
  surfaces; admin status (New/In Progress/Complete) is derived in `lib/admin-status.ts`, never
  stored; the customer results page renders `final_report` over `gap_analysis` so manual and
  automated verdicts look identical; `verifications.requirements` has TWO shapes (web `{text}`,
  API `[{type:'text',value}]`) — always normalize; baseline checks + OCR prompts are runtime
  config (`/admin/configs` → `app_config` table), defaults live in `lib/claude.ts`; API keys are
  stored hashed and shown once (self-serve manager on `/app/docs`).

## Load-bearing local-dev workarounds — do NOT revert without understanding

- **Node TLS bug on this machine** corrupts large uploads to Anthropic (`BAD_RECORD_MAC`).
  `lib/anthropic-fetch.ts` routes the Claude SDK through system `curl` in local dev; `app/api/verify`
  downscales images with `sharp`. Production (Vercel) uses native fetch.
- `next.config.ts` → `experimental.proxyClientMaxBodySize: '30mb'` (proxy body cap; needed for
  multipart uploads).
- Magic-link email only reaches the project owner until SMTP is configured.
- **Column-level grants on `verifications`:** publish-gating grants the `authenticated` role
  SELECT on only a subset of columns (analysis fields excluded). That applies to the admin's
  session too, so `select('*')` with the session client fails with `permission denied` and can
  render as a silently empty page. **All `/admin` pages and actions use `createServiceClient()`
  after `requireAdmin()`** — keep it that way, and never swallow a Supabase `error` when rendering.

## Conventions

- Next 16 middleware lives in **`proxy.ts`** (exported `proxy()`), not `middleware.ts`.
- **Design system (canonical):** the Krida-inspired system in `website/HANDOFF.md`
  §3–§5 (warm cream paper, warm near-black ink, electric lime accent; Newsreader / Hanken
  Grotesk / JetBrains Mono; pill buttons, big soft rounded cards, mono eyebrows). The app
  mirrors it via `lib/theme.ts` (`C`). Any new UI in either repo follows that doc by default.
  Inline styles, no Tailwind, in the app surfaces.
- **No em dashes in user-facing copy.** No phone numbers in customer-facing copy either
  (2026-07-11): point users to "a Fordra admin" instead. The number (727) 729-9594 survives
  only inside the frozen /demo surface.
- DB migrations: `supabase/migrations/*.sql`, applied with `npm run db:migrate` (needs
  `SUPABASE_DB_URL`). `POSTGRES_URL` is a *separate legacy Prisma DB* for the demo — not Supabase.
- Clean up any test rows + storage objects written to the live DB during testing.
- Anthropic/Claude work: consult the `claude-api` skill; default model `claude-sonnet-4-6`.
