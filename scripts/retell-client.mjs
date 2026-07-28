/**
 * Fordra — shared Retell client for the operator scripts
 *
 * Loads .env.local (same dependency-free loader as scripts/migrate.mjs) and
 * builds a retell-sdk client.
 *
 * NEVER fetch('https://api.retellai.com/...') by hand. Retell versions and
 * renames paths constantly and emails the workspace owner about every legacy
 * hit; the SDK already targets the current ones. See HANDOFF.md, rule 4 under
 * "CONFIGURE THE RETELL AGENT VIA THE API".
 *
 * Not importable from the app: lib/retell.ts is 'server-only' and its exports
 * are deliberately scoped to call dispatch/stop, so these scripts build their
 * own client rather than reaching into it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Retell from 'retell-sdk'

// load .env.local without a dependency
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
try {
  for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env.local — rely on real env */ }

// These are top-level-await scripts, so a rejected SDK call would otherwise dump
// the whole APIError plus a stack trace. Operators want one line. A rejected
// top-level await surfaces as an uncaught exception rather than an unhandled
// rejection, so both hooks are needed. Anything without an HTTP status is a real
// bug, not an API response — keep its stack so it stays debuggable.
function reportAndExit(err) {
  if (err?.status) {
    const message = err?.error?.message ?? err?.message ?? String(err)
    console.error(`\n❌  Retell API error (HTTP ${err.status}): ${message}\n`)
  } else {
    console.error('\n❌  Unexpected failure:\n', err)
  }
  process.exit(1)
}
process.on('unhandledRejection', reportAndExit)
process.on('uncaughtException', reportAndExit)

/** The Retell client, or exit(1) with a readable message if the key is missing. */
export function retellClient() {
  const apiKey = process.env.RETELL_API_KEY
  if (!apiKey) {
    console.error(
      '\n❌  No RETELL_API_KEY. Set it in .env.local (Retell Dashboard → Settings → API Keys).\n',
    )
    process.exit(1)
  }
  return new Retell({ apiKey })
}

/** The agent to act on: explicit argument wins, else RETELL_AGENT_ID. */
export function resolveAgentId(explicit) {
  const agentId = explicit || process.env.RETELL_AGENT_ID
  if (!agentId) {
    console.error(
      '\n❌  No agent id. Pass one as the first argument, or set RETELL_AGENT_ID in .env.local.\n',
    )
    process.exit(1)
  }
  return agentId
}

/** Minimal `--flag=value` / positional splitter (no dependency, no aliases). */
export function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (const arg of argv) {
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/)
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2]
    else positional.push(arg)
  }
  return { flags, positional }
}
