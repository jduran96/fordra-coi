/**
 * Route handler implementations for /api/slack/* (the files under app/api/slack
 * are thin re-exports so all Slack logic stays in this folder).
 *
 * Gatekeeping model:
 *  - Install: only via an /admin-generated link whose signed `state` carries the
 *    org_id. The OAuth callback rejects anything else, so random workspaces can
 *    never connect even if they discover our client_id.
 *  - Runtime: every event is signature-verified and its team_id must match an
 *    active slack_installations row; optional per-user whitelist on top.
 */
import { after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  BOT_SCOPES, installRedirectUri, oauthAccess, postMessage,
  slackEnv, verifyInstallState, verifySlackSignature,
} from './slack'
import { handleIntakeMessage, type Installation, type SlackMessageEvent } from './intake'

// ---- GET /api/slack/oauth — entry point of an install link ----------------
export async function handleOAuthStart(request: Request): Promise<Response> {
  const state = new URL(request.url).searchParams.get('state') ?? ''
  if (!verifyInstallState(state)) {
    return htmlPage('Invalid link', 'This install link is invalid or has expired. Ask a Fordra admin for a new one.', 403)
  }
  const url = new URL('https://slack.com/oauth/v2/authorize')
  url.searchParams.set('client_id', slackEnv().clientId)
  url.searchParams.set('scope', BOT_SCOPES.join(','))
  url.searchParams.set('state', state)
  url.searchParams.set('redirect_uri', installRedirectUri())
  return Response.redirect(url.toString(), 302)
}

// ---- GET /api/slack/oauth/callback -----------------------------------------
export async function handleOAuthCallback(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const code = params.get('code')
  const verified = verifyInstallState(params.get('state') ?? '')
  if (!verified) {
    return htmlPage('Not authorized', 'This install was not authorized. Contact a Fordra admin for help.', 403)
  }
  if (!code) return htmlPage('Install canceled', 'Slack did not complete the install. You can retry from your install link.', 400)

  let access
  try {
    access = await oauthAccess(code, installRedirectUri())
  } catch {
    return htmlPage('Install failed', 'Slack rejected the authorization. Retry from your install link. If this keeps happening, contact a Fordra admin for help.', 502)
  }

  const svc = createServiceClient()
  const { error } = await svc.from('slack_installations').upsert({
    team_id: access.team!.id,
    team_name: access.team!.name ?? null,
    org_id: verified.orgId,
    bot_token: access.access_token!,
    bot_user_id: access.bot_user_id!,
    installed_by_slack_user: access.authed_user?.id ?? null,
    revoked_at: null,
  }, { onConflict: 'team_id' })
  if (error) return htmlPage('Install failed', 'We could not save the connection. Contact a Fordra admin for help.', 500)

  return htmlPage(
    'Fordra Connected',
    'Your Slack workspace is now connected. Open a direct message with the Fordra app and send a COI to start a verification.',
  )
}

// ---- POST /api/slack/events -------------------------------------------------
export async function handleEvents(request: Request): Promise<Response> {
  const rawBody = await request.text()
  if (!verifySlackSignature(rawBody, request.headers)) {
    return new Response('bad signature', { status: 401 })
  }

  const body = JSON.parse(rawBody) as {
    type: string
    challenge?: string
    event_id?: string
    team_id?: string
    event?: SlackMessageEvent
  }

  // Slack URL verification handshake when saving the request URL.
  if (body.type === 'url_verification') {
    return Response.json({ challenge: body.challenge })
  }
  if (body.type !== 'event_callback' || !body.event || !body.team_id) {
    return new Response('ok')
  }

  // Retries and duplicate deliveries: always ack, process an event_id once.
  const svc = createServiceClient()
  if (body.event_id) {
    const { error } = await svc.from('slack_events_seen').insert({ event_id: body.event_id })
    if (error) return new Response('ok') // already seen (or dedup unavailable): don't double-process
  }

  const ev = body.event
  if (ev.type !== 'message' || ev.bot_id || !ev.user) return new Response('ok')

  const { data: install } = await svc.from('slack_installations')
    .select('id, team_id, org_id, bot_token, bot_user_id, allowed_slack_users, revoked_at')
    .eq('team_id', body.team_id)
    .maybeSingle()

  // Ack within Slack's 3s window; do the real work after the response.
  after(async () => {
    try {
      if (!install || install.revoked_at) return // no token to reply with anyway
      await handleIntakeMessage(install as unknown as Installation, ev)
    } catch (e) {
      console.error('slack intake failed', e)
      if (install?.bot_token) {
        await postMessage(install.bot_token, ev.channel, 'Sorry, something went wrong on my end. Please try again.').catch(() => {})
      }
    }
  })
  return new Response('ok')
}

function htmlPage(title: string, message: string, status = 200): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:'Hanken Grotesk',system-ui,sans-serif;background:#faf6ef;color:#191713;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:420px;padding:40px;background:#fff;border:1px solid #e5ded1;border-radius:20px;text-align:center}
h1{font-family:Newsreader,Georgia,serif;font-weight:400;font-size:26px}</style></head>
<body><main><h1>${title}</h1><p>${message}</p></main></body></html>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}
