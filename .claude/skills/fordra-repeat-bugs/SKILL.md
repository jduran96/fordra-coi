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
- `{token}` placeholders: `formatCurrencyInput` strips non-digits, so template
  tokens like `{asset_sale_price}` cannot pass through it. The shared
  RequirementsEditor therefore formats Limit amounts only when the value is
  purely numeric (`smartLimitInput`), and per-deal "Variable" amounts are
  authored as plain titles that `normalizeRequirementRows` converts to
  `{tokens}` at save time — never run variable titles or token text through
  `formatCurrencyInput`.
- `requirement_templates` has a partial unique index (one `is_default` per
  org): clear the existing default before setting a new one, as
  `saveTemplate` in `app/app/settings/actions.ts` does.

## 9. Email buttons render tiny/collapsed in Gmail

**Symptom:** the Sign in / Accept invitation button in auth emails is a thin
pill hugging the text in Gmail; the Supabase dashboard preview looks perfect.

**Root cause (two-part):**
- The send pipeline hard-wraps long HTML lines, and a wrap landing inside a
  quoted CSS string (e.g. `'Segoe UI'`) is invalid CSS — Gmail's sanitizer
  then drops the element's styles entirely, while browser previews forgive it.
- Dashboard template edits silently fail to persist if Save isn't clicked on
  that specific tab; the old mangled template keeps being sent, so "I fixed
  the template" appears to change nothing.

**Fix:** templates in `supabase/email-templates/` use only unquoted font
stacks (`Georgia,serif`, `Arial,Helvetica,sans-serif`), keep attribute values
short, and put button sizing on the `<td>` (bulletproof pattern), never on
the `<a>`. After pasting into the dashboard, reload the page to confirm the
save stuck, then send a FRESH email — received emails never re-render. Debug
with Gmail's Show original: it reveals exactly which markup was sent.

## 10. Magic-link / invite links "expired or already used" on first click

**Symptom:** a sign-in link (magic-link email, invite email, or copied admin
link) fails immediately with the /login?error=link screen, even freshly
minted, clicked seconds after receipt, well within expiry.

**Root cause (two-part):** token_hash links are single-use and last-one-wins.
- Anything that prefetches URLs consumes the token before the human clicks:
  Slack/iMessage link previews, and Gmail's link scanner on incoming email
  (probabilistic — the same flow can pass tests for days, then fail). Any
  link pointing straight at /auth/callback is vulnerable.
- Minting a new magiclink for a user invalidates all their older ones
  (verified live: older token -> `otp_expired`). The original SigninLinkButton
  minted on every popup open, silently killing the link the admin just sent.
  Cross-type is safe: a magiclink mint does NOT kill an emailed invite token.

**Fix (in place):** every link — emails via emailRedirectTo/redirectTo, and
admin-minted links — points at the `/auth/link` interstitial, which consumes
nothing on GET. Real browsers auto-continue via JS (AutoContinue component,
"Signing you in…" flash); crawlers don't execute JS, and the no-JS fallback
is a form-GET button (crawlers don't submit forms either). The Invite-link
popup reuses its minted link on reopen and only mints again via the explicit
Regenerate button. Never hand out raw /auth/callback URLs, never point
emailRedirectTo at /auth/callback, and never mint a magiclink as a side
effect of a repeatable action.

## 11. Editing template rows on /app/new makes all per-deal variable prompts vanish

**Symptom:** with a saved standard selected on the new-verification form, adding
a Variable row (or switching a row's Type to Variable) makes the entire "This
standard needs the following for each deal:" section disappear, including the
prompts for OTHER, untouched variable rows. Deleting rows alone looks fine.

**Root cause:** the form derives the per-deal inputs live on every keystroke via
`normalizeRequirementRows(tplRows)` (`app/app/new/NewVerificationForm.tsx`). A
freshly added Variable row is inherently incomplete (`setKind` clears the Amount
cell), and `normalizeRequirementRows` used to bail on the first incomplete
variable row by returning `{ requirements: [], variables: [], error }` — wiping
every derived variable, so the whole section unmounted mid-edit.

**Fix (in place — keep this contract):** `normalizeRequirementRows`
(`lib/templates.ts`) is non-destructive on error: it records the FIRST error,
skips only the offending row, and still returns the requirements/variables
accumulated from all valid rows. Every caller (settings save, admin org
standards, `submitVerification`, the live form derivation) treats a set `error`
as blocking, so nothing incomplete can be saved or submitted. When adding a new
validation rule to this function, follow the same pattern: set `error` and
`continue`; never return empty arrays, because the live form derivation renders
from them while the user is mid-edit.

## 12. Magic links "already used" for a user on corporate email (DECIDED RISK)

**Symptom:** one specific user (or one company's users) reports every sign-in
link fails as expired/already-used on first click, while everyone else is fine.
Gmail/personal-mail users unaffected.

**Root cause:** /auth/link's AutoContinue redirects via JS. Enterprise mail
scanners that EXECUTE JavaScript (Outlook SafeLinks, Proofpoint URL Defense)
therefore consume the single-use token before the human clicks. The
interstitial only defeats non-JS crawlers (entry #10).

**Status (RESOLVED 2026-07-11, ahead of the Dakota/HaulPay pilot):**
AutoContinue is gone; /auth/link shows a human-click "Sign in" button (form
GET to the callback). Scanners render but do not click buttons, so tokens now
survive JS-executing scanners too. Do not reintroduce auto-navigation or a
plain link to the callback on that page. If a corporate user STILL reports
dead links, their scanner is one of the rare form-submitting kind: mint a
direct link from /admin/users and send it over a channel that does not scan.

## 13. A submitted insurance standard silently vanishes from the checks

**Symptom:** a standard the submitter entered (or added later) never appears in
the requirement checks, insurer questions, or admin assessment — most often a
line that OVERLAPS a broader one (seen live: a "Vehicle VIN" line swallowed by
"Vehicle listed", VRF-1055).

**Root cause:** free-form requirements parsing lets the model merge or drop
lines it judges redundant; everything downstream (gap analysis, questions,
assessment rows) only ever sees parsed requirements, so a merged line is
unrecoverable.

**Fix (in place — keep these contracts):**
- The submitter's own standards parse via `parseRequirementLines`
  (`lib/claude.ts`): STRICT one-requirement-per-numbered-line, with a
  deterministic `parseStandardLine` fallback when the model breaks the
  contract. Only uploaded standards DOCUMENTS (free-form prose) go through
  the open `parseRequirements`.
- `ensureAllRequirementsJudged` (`lib/extraction.ts`) appends any requirement
  the gap model failed to judge to `uncertain` — never silently dropped.
- Insurer questions regenerate from CURRENT requirements on every re-run,
  keep mode included, so added/removed standards propagate.
- The admin assessment appends normalized requirements missing from the saved
  rows as Unconfirmed rows (label/notes match). Legacy assessments can show a
  one-time renamed-row duplicate — remove one; never hide a standard instead.

## 14. Slack intake: one reply word triggers TWO steps in the same turn

**Symptom:** a single Slack reply advances the intake conversation two steps
at once — seen live: replying "yes" to confirm the saved standard ALSO
submitted the verification, skipping the optional-documents prompt.

**Root cause:** the intake handler is one linear pass per message. A reply
consumed by an earlier step (the standards state machine) still falls through
to later gates in the same invocation, and "yes" is both the standard-confirm
word and a member of isSubmitWord (done/submit/yes/go/send it).

**Fix (in place — keep the contract):** any message consumed as an answer to
the standards step sets `standardsConsumedReply` in `Slack/intake.ts`, and
the final submit gate treats such a message as never being the submit word.
When adding new reply keywords to any intake step, check they don't collide
with isSubmitWord (or any later gate) for the same message.

## 15. Admin form shows stale values right after a successful save

**Symptom:** an admin edit form (uncontrolled inputs/selects with defaultValue
+ a server action) saves correctly — DB has the new value — but the form
snaps back to the OLD values after submit, so the admin thinks the save
failed and retries.

**Root cause:** React 19 resets uncontrolled form fields to their
defaultValue after a form action completes, and that defaultValue comes from
the STALE render; when the revalidated RSC payload lands, React does not
re-apply a changed defaultValue to existing DOM inputs.

**Fix:** key the client form component by its data so fresh data remounts it
with correct defaults, e.g. `<ContactCheckPublicForm key={JSON.stringify(check)} ...>`
(same pattern AssessmentForm uses on the admin detail page). Alternative:
controlled inputs.

## 16. Customer-facing notification emails must stay airtight opt-in (INVARIANT)

**Not a bug — a contract to check BEFORE touching any email or publish/fail
code.** Owner rule (2026-07-16): emails to admins are recoverable mistakes;
emails to customers/app users are not — one accidental blast can kill a pilot.
Every send to an app user must be explicitly human-confirmed, per action.

**The one customer send path (audited 2026-07-16, keep it this shape):**
`notifyVerificationResult` (`lib/notify.ts`) has exactly ONE call site —
`saveAssessment` in `app/admin/(console)/actions.ts` — gated by ALL of:
`requireAdmin()`, intent `publish`/`fail` (save/reopen/unknown never notify),
`notify_user === 'on'` from the form, `created_by` set, profile email found.
The `notify_user` checkbox exists ONLY inside the publish/fail confirm dialogs
(`NotifyUserChoice` in `components/AssessmentForm.tsx`), default UNCHECKED,
unmounted on cancel so a checked box can't leak into a later submit. One send
per confirmed action, single recipient, `after()`-deferred, no retry loop, and
every send is recorded in the admin activity log ("Notified <email>: …").

**When adding ANY new email to app users, verify before shipping:**
- No automatic trigger: not from submission, extraction, webhooks, cron,
  Slack, or /v1 — only from an explicit admin confirm with a default-off
  checkbox scoped to that single action.
- Sends must be un-loopable: no retries on failure (log and give up, like
  both senders in `lib/notify.ts`), disabled submit while pending
  (`PendingButton`), one recipient per call.
- Grep for every call site of the sender and every reader of the form flag;
  each must sit behind `requireAdmin()` and the per-action opt-in.
- Leave an audit trail per send (activity log), so "how many emails went out
  and who authorized them" is always answerable.
