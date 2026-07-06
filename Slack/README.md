# Slack intake

Design partners create verification requests by DMing the Fordra Slack app:
they send a COI, the bot asks for the carrier name and insurance requirements
(text or document, rate confirmation optional), then it creates a pending
verification that shows up as **New** in `/admin` and in the org's portal.
Intake only in v1: results are viewed in the portal, not posted back to Slack.

## Files

- `slack.ts` - signature verification, Web API wrapper, file download, signed install-link state
- `intake.ts` - the DM slot-filling conversation, ends in `createVerification()` (`lib/verifications.ts`)
- `routes.ts` - handler logic for the three HTTP endpoints
- `manifest.yml` - paste into api.slack.com when creating the app
- The actual Next.js routes are thin re-exports in `app/api/slack/{events,oauth,oauth/callback}/route.ts`
  (Next only serves routes from `app/`), everything substantive lives here.

## Auth and gatekeeping

- The app is never publicly listed. The only working install path is
  `/api/slack/oauth?state=<signed>`, where `state` is HMAC-signed `{org_id, exp}`
  (signed with `SESSION_SECRET`). Links are generated per org from `/admin/slack`
  and expire after 7 days. The OAuth callback rejects installs without a valid
  state, so a bare Slack authorize URL with our client_id is useless.
- At runtime every event is verified against `SLACK_SIGNING_SECRET` and its
  `team_id` must match an active `slack_installations` row. Revoke a workspace
  from `/admin/slack` (sets `revoked_at`) to shut it off instantly.
- Optional per-user whitelist: `slack_installations.allowed_slack_users`
  (null = whole workspace). Unauthorized users get a reply containing their
  Slack ID so it is easy to whitelist them.

## One-time Slack app setup

1. https://api.slack.com/apps -> Create New App -> From a manifest -> paste `manifest.yml`
   (point the two URLs at your deployment or tunnel first).
2. Settings -> Manage Distribution -> enable public distribution (required to
   install into workspaces other than the app's home workspace; App Directory
   listing/review is NOT required and install links stay private).
3. Copy Basic Information credentials into env (local `.env.local` + Vercel):
   `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`.
4. Run the migration: `npm run db:migrate` (adds `slack_installations`,
   `slack_intake_sessions`, `slack_events_seen`).

## Testing on a personal workspace

1. Point the manifest URLs at either the deployed Vercel app (recommended) or a
   local tunnel (`cloudflared tunnel --url http://localhost:3000`). Slack pings
   the events URL with a `url_verification` challenge when you save it.
2. In `/admin/slack`, generate an install link for a test org and open it;
   approve the install into your workspace.
3. DM the Fordra app: upload a sample COI PDF, answer the carrier-name prompt,
   paste requirements text, reply `done`. The request appears as New in `/admin`.
4. Also try: requirements as a file, rate confirmation attached up front,
   `cancel`, and re-delivery (Slack retries are deduped via `slack_events_seen`).
5. Clean up test verifications, documents rows, and storage objects afterwards
   (including any `slack-intake/...` temp objects and intake sessions).

For the design partner: generate a link for their org and send it to them.
Nothing else is needed from their side; the callback maps their workspace to
their org automatically.
