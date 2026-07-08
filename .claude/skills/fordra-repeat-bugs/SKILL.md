---
name: fordra-repeat-bugs
description: Checklist of Fordra's known recurring bugs and their canonical fixes. Use BEFORE debugging any auth/login issue, silent empty page, extraction failure, or requirements-parsing oddity in this repo, and BEFORE writing code that touches those areas. Each entry is symptom -> root cause -> fix, so past bugs are recognized instead of re-diagnosed from scratch.
---

# Fordra repeat bugs checker

Known recurring bugs in this codebase. When a symptom below appears, apply the
documented fix; do not re-diagnose from zero. When fixing any NEW recurring bug,
append an entry here in the same symptom/cause/fix format.

## 1. Magic-link login bounces back to the email input screen

**Symptom:** user clicks the sign-in email link and lands back on /login with no
message. Server log shows `GET /auth/callback?code=... 307` then `GET /login?error=link`.

**Root cause:** the link arrived in Supabase's default PKCE `?code=` format.
`exchangeCodeForSession` needs a verifier cookie planted in the exact browser
profile that requested the link. Opening the email in another browser/profile,
or clicking an older email after requesting a second link, fails the exchange.

**Fix (already in place, do not regress):**
- The Supabase Magic Link and Invite email templates (dashboard: Authentication
  -> Emails; repo copies in `supabase/email-templates/`) link to
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=...`. The `token_hash`
  flow is stateless and works from any browser. If login breaks again, FIRST
  check the dashboard template still uses token_hash (a template reset restores
  the PKCE default and reintroduces the bug).
- `app/auth/callback/route.ts` prefers token_hash over code, and reads `next`
  from the `login-next` cookie (set by `app/login/page.tsx`, which must keep
  `emailRedirectTo` query-free so the template can append `?token_hash=`).
- The login page displays `?error=link`. Never let an auth failure land the
  user on a screen with no error message.
- To mint a direct sign-in link for anyone (testing, or email not arriving):
  POST `/auth/v1/admin/generate_link` with the service key, then
  `/auth/callback?token_hash=<hashed_token>&type=magiclink`.

## 2. Admin page renders empty / permission denied on verifications

**Symptom:** an /admin page shows an empty queue or 500s; Supabase error
`permission denied for table verifications` (sometimes swallowed).

**Root cause:** column-level grants on `verifications` give `authenticated`
SELECT on only a subset of columns (analysis fields excluded, part of publish
gating). This applies to the admin's session client too, so `select('*')` fails.

**Fix:** every /admin page and action uses `createServiceClient()` after
`requireAdmin()`. Never use the session client for verifications reads in
admin code, and never swallow the Supabase `error` when rendering. When adding
a column customers must read/write, add explicit column grants in a migration
(see `0011_requirement_templates.sql` for the pattern).

## 3. Requirements JSONB has multiple shapes — always normalize

**Symptom:** requirements text comes out empty or as `[object Object]` for some
verifications but not others.

**Root cause:** `verifications.requirements` stores different shapes by source:
web `{ text }` (+ template provenance keys), API/Slack `[{ type: 'text', value }]`
(+ optional `{ type: 'template', ... }` entries).

**Fix:** never assume one shape. Copy the normalization in
`lib/extraction.ts` (array -> filter `type === 'text'` -> join; object -> `.text`).

## 4. Large uploads to Anthropic fail locally (BAD_RECORD_MAC)

**Symptom:** local extraction dies with `ERR_SSL_..._BAD_RECORD_MAC` on big files.

**Root cause:** Node TLS bug on this machine corrupts large HTTPS bodies.

**Fix (load-bearing, do not revert):** `lib/anthropic-fetch.ts` routes the SDK
through system curl when `!process.env.VERCEL`; `app/api/verify` downscales
images with sharp. Production uses native fetch.

## 5. tsc fails only inside .next/ after adding/removing routes

**Symptom:** `npx tsc --noEmit` errors referencing `.next/dev/types` or
`.next/types` route validators.

**Root cause:** stale generated route types.

**Fix:** ignore `.next/*` errors (`grep -v '^\.next/'`); `npx next build` is
the authoritative check and regenerates them.

## 6. Extraction dies silently on Vercel

**Symptom:** admin Run extraction never completes in production; works locally.

**Root cause:** the pipeline makes 2-3 Claude calls (vision OCR included) and
exceeds Vercel's default function duration; the platform kills it mid-run.

**Fix:** `app/admin/[id]/page.tsx` exports `maxDuration = 300` (covers the
server action). Any new route/page that triggers `runExtractionPipeline`
(`lib/extraction.ts`) must export a raised `maxDuration` too.

## 7. Config/dashboard changes silently mask code changes

**Symptom:** a prompt or baseline-check change in `lib/claude.ts` has no effect.

**Root cause:** `app_config` rows (edited at /admin/configs) override the
`DEFAULT_*` constants; stored overrides keep winning after defaults change.

**Fix:** after changing any default prompt/baseline in code, check /admin/configs
(or the `app_config` table) and delete or hand-merge the stored override.

## 8. Shared prod/local infrastructure — know the blast radius

- Local dev and production share ONE Supabase project: migrations, auth email
  templates, SMTP settings, and data changes hit both immediately. "Test
  locally" never isolates the database.
- Test rows/storage written to the live DB must be cleaned up afterward
  (storage objects via the Storage API, not SQL).
- `{token}` placeholders: currency-formatted inputs (`formatCurrencyInput`)
  strip non-digits, so template tokens like `{asset_sale_price}` cannot pass
  through currency fields — template rows use plain text inputs on /app/settings.
- `requirement_templates` has a partial unique index (one `is_default` per
  org): clear the existing default before setting a new one, as
  `saveTemplate` in `app/app/settings/actions.ts` does.
