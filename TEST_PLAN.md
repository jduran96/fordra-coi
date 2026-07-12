# Fordra — Pre-freeze production test plan

> Goal: run this docket top to bottom, check every box, and the app is certified
> production-grade for the code-freeze week. P0 = freeze blockers (must pass before
> freeze). P1 = should pass; a failure here needs an owner decision to waive.
> P2 = nice-to-verify; log failures for after the freeze.
>
> ⚠️ **Prod and local share ONE Supabase project.** Prefer testing against
> **app.fordra.com** (that's what is being frozen; local passes don't prove Vercel
> behavior like `maxDuration` and UTC timestamps). Clean up ALL test data afterward —
> see the Cleanup section at the bottom.
>
> Items marked **[docket]** are the six from HANDOFF.md's pending manual test docket.

## Test fixtures to prepare first

- [ ] A real COI PDF + a rate confirmation sheet (the usual demo pair).
- [ ] An insurance-standards file in each format: `.pdf`, `.docx`, `.txt`.
- [ ] A junk file over 20MB (e.g. `mkfile -n 25m big.pdf` or a large video renamed).
- [ ] A non-document file (e.g. `.zip`) for type rejection.
- [ ] Two test users: one on Gmail/personal mail, one you can use as "customer B" in a
      second org (for isolation tests). A throwaway org "ZZ Test Org".
- [ ] One `sk_test_` and one `sk_live_` key minted from /app/docs for the test org.
- [ ] A webhook receiver you can inspect (e.g. webhook.site URL registered as the test
      org's endpoint).
- [ ] A second browser or private window (for cross-browser link tests and two-session tests).

---

> **2026-07-11 late additions:** the one-click sign-in interstitial (N-series: fresh
> link, admin, invite token, minted link, reuse error, preview survival, corporate
> mailbox, incomplete link, deep-link next) **passed in full, owner-tested.** The
> new-submission email alerts (M-series, M1-M6) are pending owner testing on
> 2026-07-12 (calendar reminder set).

## A. Auth and sessions (P0)

- [ ] **A1 [docket #1a].** Customer magic-link sign-in on /login (Gmail account): email
      arrives (Resend SMTP), link goes to `/auth/link`, spinner auto-continues, lands on
      /app. Regression target: the 2026-07-10 callback cookie hardening.
- [ ] **A2 [docket #1b].** Admin magic-link sign-in on /admin/login with an
      `ADMIN_EMAIL` allowlisted address: lands on /admin queue.
- [ ] **A3.** Request a link, open the email **in a different browser** than the one
      that requested it: still signs in (proves the `token_hash` template is intact in
      the Supabase dashboard — repeat-bug #1; a template reset silently reverts to PKCE).
- [ ] **A4.** Paste a sign-in link into a Slack DM or iMessage to yourself, wait for the
      preview to render, THEN click it: still signs in (interstitial consumes nothing on
      GET — repeat-bug #10).
- [ ] **A5.** Click an already-used or second-oldest link: lands on /login with a
      visible error message, never a blank bounce.
- [ ] **A6.** Password sign-in on /login (if the test user has a password set) works and
      lands on /app.
- [ ] **A7 [docket #5].** Non-admin signs in, visits /admin: access-denied page; its
      Sign out button actually signs out (POST signout fix) and a subsequent /app visit
      requires login.
- [ ] **A8.** Signed-out visits: `/app`, `/app/<real id>`, `/admin`, `/admin/<real id>`
      all redirect to the correct login (customer vs admin), never render data. Root `/`
      redirects to /app.
- [ ] **A9.** Sign out from /app and from /admin: cookies cleared, back button does not
      show authed content after reload.
- [ ] **A10 (P1).** 24h hard expiry: sign in, then next day (or after editing
      `last_sign_in_at` back 25h via SQL on the test user) load /app and /admin:
      redirected to /login?expired=1 with sb-cookies cleared. Same-day check: /demo
      token expiry after 24h (or temporarily shorten locally).
- [ ] **A11.** Invite flow: /admin/users invite a brand-new email; invite email is
      branded, button renders full-size in Gmail (repeat-bug #9), link signs the user in.
- [ ] **A12.** Invite-link popup: open it twice — same link both times (no silent
      re-mint, repeat-bug #10); Regenerate mints a new link and the OLD magic link of
      the same type stops working; re-inviting an existing user mints a fresh link
      instead of erroring.

## B. Customer portal /app (P0)

- [ ] **B1.** First-time user with no org sees the generic "Please contact a Fordra
      admin to set up your account." screen (no phone number anywhere in customer
      copy), not an empty or broken list. Path: invite or Edit User with the
      "No organization" option (added 2026-07-11).
- [ ] **B2.** Verifications list renders: pending rows, completed rows, and a red
      Rejected pill on rejected rows. Timestamps read like
      "7/10/2026, 6:00 PM (Pacific US)" — verify **in prod** (Vercel renders UTC).
- [ ] **B3.** Submit via /app/new with the org's default template: template
      pre-selected, requirements render as read-only bullets, `{carrier_name}` auto-fills
      from the carrier field, other tokens appear as per-deal FREE-TEXT inputs in their
      own card (type nonsense like "12a-b" — it must not be currency-masked).
- [ ] **B4.** Edit modal on the template rows: add a Variable row mid-edit — the
      per-deal section must NOT vanish (repeat-bug #11); leave the row incomplete and
      Apply — blocked with a visible error, other rows intact; complete it — Apply works.
- [ ] **B5.** Submit in manual mode: the two opt-in standard checks (policyholder-name
      match, policy active) are pre-checked and can be unchecked; submission succeeds.
- [ ] **B6.** Submit with an uploaded standards **file** instead of a template — once
      with `.pdf`, once with `.docx`, once with `.txt` **[docket #2]** (the docx/txt path
      exercises the new mammoth/utf-8 extraction; previously a guaranteed crash — verify
      later in D3 that Run extraction succeeds on these).
- [ ] **B7 [docket #3].** Attach a >20MB COI: friendly client-side error, no stuck
      spinner, form still usable. Also try the `.zip`: rejected with a clear message.
      (Superseded expectation: with direct-to-storage uploads a ~6MB file should now
      SUCCEED in prod — that's test B16.)
- [ ] **B8.** Publish gating: while a submission is unpublished, the customer detail
      page shows NO analysis/verdict; after admin publishes (C-section), the verdict
      appears; after admin reopens + saves a draft, it disappears again for the customer.
- [ ] **B9.** Manual vs automated verdict parity: a manually-published assessment
      (`final_report`) renders identically in layout to a pipeline result on the customer
      page.
- [ ] **B10.** Rejected case: customer list + detail show the red pill and the exact
      approved copy "This verification request was rejected by a Fordra admin. Contact
      us to learn more."
- [ ] **B11.** PDF download on a **published** verification: /app/[id]/pdf returns a
      well-formed PDF (fonts render — pdfkit external package check on Vercel).
      On an **unpublished** one: no analysis leaks (blocked or gated content only).
- [ ] **B12 [docket #4].** /app/garbage-id shows the branded "Page not found" with
      subtext "Does not exist or extra permissions required. Contact a Fordra admin
      for help." (approved copy 2026-07-11).
- [ ] **B15 (new 2026-07-11).** "Any other relevant documents" section on /app/new:
      attach 2-3 files (one with the same filename twice; include a .docx or .txt),
      all listed with Remove buttons, cap enforced at 5; after submit the customer
      detail page shows them under "Other documents" and admin Run extraction ingests
      them.
- [ ] **B16 (new 2026-07-11, direct-to-storage uploads).** Submit a 5-9MB COI in
      PROD (previously impossible past ~4.5MB); an 11MB file → friendly "larger than
      10 MB" error; kill the network mid-upload → form shows an upload error, no
      stuck spinner; a description-less requirement row blocks submit with "Add a
      description for ..." (VRF-1043 regression).
- [ ] **B17 (new 2026-07-11).** Closed-case call notes: on a published or rejected
      case the Log-a-call form and per-note Delete are gone, replaced by the
      "case is closed" note; after Edit Status → reopen they return.
- [ ] **B13.** /app/settings: create a template, edit it, set a different template as
      default (old default clears — partial unique index), delete one. Team self-invite
      sends an invite for the OWN org only.
- [ ] **B14.** /app/docs: mint an API key — full key shown ONCE; list shows prefix +
      last-used; revoke works (verify the revoked key 401s in D-section).

## C. Admin console /admin (P0)

- [ ] **C1 [docket #6a].** Queue: shows ALL orgs' verifications, split into
      awaiting-review and completed; derived statuses correct (New → In Progress after
      any admin action → Complete after publish; Rejected for rejected).
- [ ] **C2 [docket #6b].** Detail page: uploads open via signed URLs (COI, rate con,
      standards file all download and match what was submitted).
- [ ] **C3.** Run extraction **in prod** on the B6 submissions (pdf, docx, txt
      standards): completes without the function being killed (`maxDuration = 300`,
      repeat-bug #6), insurer-contact card + raw JSON render, requirements parsed from
      BOTH shapes (a web `{text}` submission and an API array submission — repeat-bug #3).
- [ ] **C4.** Call notes: append a note; delete one via the two-click Delete; open the
      dialog in TWO tabs and append from both — both notes survive (atomic RPC, no
      lost update); force a failed save (e.g. kill network) — dialog stays open with the
      text preserved.
- [ ] **C5.** Assessment lifecycle on one case **[docket #6c — one publish]**:
      per-requirement verdicts + evidence + summary → Save draft (customer still sees
      nothing) → Publish (customer sees it; webhook fires — check in E) → form is now
      read-only with only Edit Status → Reopen (case returns to queue as pending;
      `final_report` NOT wiped; customer still sees the last published assessment) →
      Reject (customer sees Rejected pill; assessment hidden) → Reopen again → Publish.
- [ ] **C6.** Closed-case safety: on a published case, confirm every assessment field is
      disabled and Save/Reject/Publish buttons are absent (only Edit Status).
- [ ] **C7.** /admin/users: edit a user, delete a user; Organizations table inline
      rename; **cascade-delete the ZZ Test Org at the END of testing** and confirm it
      removes members, verifications, documents + storage objects, and Slack rows, and
      only unassigns (not deletes) admin accounts.
- [ ] **C8.** /admin/settings: edit one OCR prompt, run an extraction, confirm the
      edited prompt took effect; then delete the override and confirm the default
      returns (repeat-bug #7 — stored overrides mask code defaults).
- [ ] **C9 (P1).** /admin/slack: generate an install link; confirm a tampered link
      (edit one character of the signature) is rejected.
- [ ] **C10.** Every admin page loads non-empty while signed in as admin (guards
      against the column-grant `permission denied` silent-empty failure, repeat-bug #2):
      queue, detail, users, settings, slack.

## D. Machine API /v1 (P0)

**Run by agent against app.fordra.com on 2026-07-11 with owner-provided keys; all test
rows, storage objects, and events were deleted afterward.** Remaining: the webhook
delivery part of D8 and the cross-org id fetch in D6 (needs a ZZ Test Org row).

- [x] **D1.** `POST /v1/verifications` with `sk_test_`: 201, auto-completed +
      published, canned ACME result, documents echoed. (Webhook part → D8.)
- [x] **D2.** Same POST with `sk_live_`: 201 pending, no analysis exposed.
- [x] **D3.** `insurance_standards` as a `.txt` file: accepted, stored as a
      requirements document. `template_name` + `template_variables`: variables
      substituted, no unresolved tokens, provenance recorded; missing variables →
      clean 400 naming the missing field. `GET /v1/templates` lists both templates.
- [x] **D4.** List + by-id return org rows; unpublished row: `coi_extracted`,
      `gap_analysis`, `summary` all null, `requirements` still visible (by design);
      published (sandbox) row exposes them.
- [x] **D5.** Bearer 200, Basic 200, garbage key 401 JSON, missing header 401 JSON,
      malformed revoked-prefix key 401. (Still do: revoke the real B14 key and confirm
      401 — owner.)
- [ ] **D6.** Cross-org isolation: fetch a ZZ Test Org verification id with the Fordra
      Testing key → 404. (Agent blocked from planting foreign-org rows; run after the
      owner's Round 2 creates one. Code-verified: the route filters
      `eq('org_id', auth.orgId)`.)
- [x] **D7.** Rate limit: exactly 30 POSTs allowed per minute per org, then 429 with
      the friendly JSON message; recovered after ~70s.
- [ ] **D8.** Webhook delivery (owner: needs an endpoint registered — agent was
      correctly blocked from pointing prod payloads at webhook.site): register a
      receiver, sandbox POST, verify `Fordra-Signature: t=..,v1=..` HMAC against the
      secret, payload matches GET shape, `events.attempts`/`delivered_at` recorded.
      Events rows themselves verified: created/updated recorded per submission.
- [x] **D9 (P1).** Malformed requests all return clean 4xx JSON: missing
      carrier_name/coi/standards, zip-as-coi (sniffed + rejected), non-multipart,
      unknown template, invalid `template_variables`, garbage id → 404. **Exception:
      see the size-cap finding below.**

> ⚠️ **Pre-freeze finding (owner decision needed): prod request bodies cap at
> ~4.5MB, not 20MB.** Vercel's serverless payload limit rejects multipart bodies
> over ~4.5MB with a raw text 413 `FUNCTION_PAYLOAD_TOO_LARGE` before the app's
> friendly 20MB check ever runs (probed live: 4MB → 201, 5MB → 413). This applies
> to `/v1` AND to /app/new's server action, whose client-side check only blocks
> >20MB per file — so a 5-15MB scanned COI passes the client check and hits an
> unbranded platform error. The 20MB/30MB numbers in code are unreachable in prod.
> Options: accept + document a 4MB limit (and lower the client check to match), or
> post-freeze move to direct-to-storage signed uploads. Test B7 expectation
> adjusted accordingly.

## E. Slack intake (P1)

Per Slack/README.md walkthrough, with the test org.

- [ ] **E1.** Install via a fresh signed link from /admin/slack: OAuth completes and the
      installation row is active. An unsigned or expired link fails.
- [ ] **E2.** DM the bot a COI file: it collects carrier name + requirements
      conversationally and creates a verification that appears in /admin + /app.
- [ ] **E3.** Ask for a template by name: bot resolves it and collects the per-deal
      variable values.
- [ ] **E4.** Replay/dedupe: Slack retries (or resend the same event) do not create
      duplicate verifications (`slack_events_seen`).
- [ ] **E5.** If a per-user whitelist is configured: a non-whitelisted user gets
      declined.

## F. Demo /demo (P1 — frozen surface, smoke only)

- [ ] **F1.** /demo/login: wrong password rejected; right password in.
- [ ] **F2.** One full happy-path run: upload broker/carrier/COI/rate-con/standards →
      extraction → gap analysis → (skip or run the Retell call) → Preliminary/Final
      report renders, final summary includes the policyholder-name check.
- [ ] **F3.** Demo rate limit: 11th /api/verify inside 10 minutes from one IP → 429
      friendly message.

## G. Cross-cutting, security and failure modes (P0 unless noted)

- [ ] **G1.** **RLS isolation in the browser:** sign in as customer B (second org) and
      try org A's verification URL directly (`/app/<orgA-id>` and its `/pdf`): branded
      not-found, no data leak.
- [ ] **G2.** Error surface: force a server error (e.g. temporarily bad id shape or a
      killed network mid-action) → branded app/error.tsx with the approved copy, no
      stack trace, no raw Supabase error text.
- [ ] **G3.** Storage privacy: copy a document's storage path and request it without a
      signed URL (raw public URL) → denied (bucket is private).
- [ ] **G4.** Copy sweep (P1): spot-check new/changed screens for em dashes in
      user-facing copy and confirm NO phone number appears outside /demo
      (convention changed 2026-07-11); approved reject/error strings unmodified.
- [ ] **G5 (P1).** Marketing site nav: fordra.com Demo/Admin/App links point at
      app.fordra.com in prod; site deploys green.
- [x] **G6 (P2).** Build health: `npx next build` clean; `npx tsc --noEmit` clean
      ignoring `.next/*` (repeat-bug #5). *(Verified by agent 2026-07-11.)*

## Known-and-accepted (do NOT fail the freeze on these)

- Corporate-email mail scanners (SafeLinks/Proofpoint) can consume magic links via the
  JS auto-continue — owner-accepted risk 2026-07-10; playbook in fordra-repeat-bugs #12.
- Webhook retries/backoff, self-serve webhook registration, Google OAuth, Phase B/C
  extractors: deferred by design (HANDOFF "Deferred" section).

## Cleanup (mandatory before declaring the freeze)

- [ ] Cascade-delete "ZZ Test Org" from /admin/users (C7 doubles as the test).
- [ ] Verify its storage objects are gone (Storage API/dashboard, not SQL).
- [ ] Revoke any surviving test API keys; delete test users; delete the webhook.site
      endpoint row.
- [ ] Delete any /demo test rows in the legacy Prisma DB if created.
- [ ] Confirm /admin/settings holds no leftover prompt overrides from C8.
- [ ] Delete test Slack installation row (or leave if the workspace is the permanent
      test bed — note it in HANDOFF).

---

**Sign-off:** all P0 boxes checked + P1 failures waived in writing here → tag the
commit `freeze-2026-07-w2` and hold `main` for the week (docs-only changes exempt).
