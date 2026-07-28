/**
 * Fordra — list recent Retell calls (read-only)
 *
 * Goes through retell-sdk, so it hits POST /v3/list-calls. Do NOT hand-roll
 * POST /v2/list-calls — that path was deprecated 2026-06-15, and v3 reshaped
 * both ends: agent filtering moved to `filter_criteria.agent[]` (v2 had a flat
 * `agent_id` array) and the response is `{items, pagination_key, has_more}`
 * rather than a bare array.
 *
 * v3 deliberately omits transcript / recording fields to keep the payload
 * lean. Fetch one call's detail for those (`call.retrieve(id)`, wrapped as
 * retrieveCall in lib/retell.ts) — the app already does this on every poll.
 *
 * Agent resolution:  first positional argument  →  RETELL_AGENT_ID
 *                    --all-agents skips the filter entirely
 * Auth:              RETELL_API_KEY (from .env.local or the real env)
 *
 * Usage:
 *   node scripts/retell-list-calls.mjs                # 20 most recent for this agent
 *   node scripts/retell-list-calls.mjs --limit=50
 *   node scripts/retell-list-calls.mjs --all-agents
 *   node scripts/retell-list-calls.mjs --json         # raw items, for piping
 */
import { retellClient, resolveAgentId, parseArgs } from './retell-client.mjs'

const { flags, positional } = parseArgs(process.argv.slice(2))
const client = retellClient()

// `--limit` with no value parses as boolean true, and Number(true) is 1 — reject
// it rather than silently listing a single call.
const limit = flags.limit === undefined ? 20 : Number(flags.limit === true ? NaN : flags.limit)
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
  console.error(`\n❌  --limit must be an integer 1-1000, got "${flags.limit}".\n`)
  process.exit(1)
}

const agentId = flags['all-agents'] ? null : resolveAgentId(positional[0])

const res = await client.call.list({
  ...(agentId ? { filter_criteria: { agent: [{ agent_id: agentId }] } } : {}),
  sort_order: 'descending',
  limit,
})

const items = res.items ?? []

if (flags.json) {
  console.log(JSON.stringify(items, null, 2))
  process.exit(0)
}

if (items.length === 0) {
  console.log(`\nNo calls found${agentId ? ` for ${agentId}` : ''}.\n`)
  process.exit(0)
}

const when = ts => (ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) : '—')
const secs = ms => (ms ? `${Math.round(ms / 1000)}s` : '—')

console.log(`\n${agentId ? `Agent ${agentId}` : 'All agents'} — ${items.length} most recent\n`)
for (const call of items) {
  console.log(
    [
      when(call.start_timestamp).padEnd(20),
      String(call.call_status ?? '—').padEnd(14),
      secs(call.duration_ms).padStart(6),
      String(call.to_number ?? call.call_type ?? '—').padEnd(16),
      call.call_id,
    ].join('  '),
  )
  if (call.disconnection_reason) console.log(`${' '.repeat(22)}↳ ${call.disconnection_reason}`)
}
console.log(res.has_more ? '\n(more available — raise --limit)\n' : '')
