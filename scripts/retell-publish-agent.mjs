/**
 * Fordra — publish the Retell agent
 *
 * Flow and agent edits (conversationFlow.update / agent.update) only ever
 * produce a DRAFT version. Nothing reaches live calls until that version is
 * published, which is what this script does.
 *
 * Goes through retell-sdk, so it hits POST /publish-agent-version/{agent_id}.
 * Do NOT hand-roll POST /publish-agent/{agent_id} — that path was deprecated
 * 2026-07-20 and its "publish whatever is latest" behaviour is gone; the
 * replacement requires an explicit `version`.
 *
 * Agent resolution:  first positional argument  →  RETELL_AGENT_ID
 * Auth:              RETELL_API_KEY (from .env.local or the real env)
 *
 * Usage:
 *   node scripts/retell-publish-agent.mjs --dry-run        # show what would publish
 *   node scripts/retell-publish-agent.mjs                  # publish the newest draft
 *   node scripts/retell-publish-agent.mjs --version=11     # publish a specific version
 *   node scripts/retell-publish-agent.mjs --description="VIN follow-up"
 *   node scripts/retell-publish-agent.mjs agent_xxx        # a different agent
 */
import { retellClient, resolveAgentId, parseArgs } from './retell-client.mjs'

const { flags, positional } = parseArgs(process.argv.slice(2))
const client = retellClient()
const agentId = resolveAgentId(positional[0])

/** Versions newest first, so [0] is the current draft when one exists. */
async function versionsNewestFirst() {
  const versions = await client.agent.getVersions(agentId)
  return [...versions].sort((a, b) => b.version - a.version)
}

const before = await versionsNewestFirst()
if (before.length === 0) {
  console.error(`\n❌  Agent ${agentId} has no versions. Check the id.\n`)
  process.exit(1)
}

const live = before.find(v => v.is_published === true)
let target
if (flags.version !== undefined) {
  // `--version` with no value parses as boolean true, and Number(true) is 1 —
  // reject it rather than targeting v1.
  const wanted = Number(flags.version === true ? NaN : flags.version)
  if (!Number.isInteger(wanted)) {
    console.error(`\n❌  --version must be an integer, got "${flags.version}".\n`)
    process.exit(1)
  }
  target = before.find(v => v.version === wanted)
  if (!target) {
    console.error(
      `\n❌  Agent ${agentId} has no version ${wanted}. Existing: ` +
      `${before.map(v => v.version).reverse().join(', ')}\n`,
    )
    process.exit(1)
  }
  if (target.is_published === true) {
    console.error(`\n❌  Version ${wanted} is already published. Nothing to do.\n`)
    process.exit(1)
  }
  // Older-than-live is a deliberate rollback, so say so loudly rather than
  // letting it read like a routine publish.
  if (live && wanted < live.version) {
    console.warn(
      `\n⚠️  v${wanted} is OLDER than the live v${live.version} — this is a rollback, ` +
      'not a release.',
    )
  }
} else {
  // The draft is the HIGHEST version, and only when it is unpublished. Do not
  // scan for "any unpublished version": version numbers get skipped (v7 here
  // was never published while v8-v10 were), and picking one of those would
  // silently roll the agent back to stale config.
  target = before[0].is_published === true ? null : before[0]
  if (!target) {
    console.log(`\n✓ Nothing to publish — v${before[0].version} is the newest and it is live.\n`)
    process.exit(0)
  }
}

console.log(`\n→ Agent  ${agentId}`)
console.log(`→ Live   ${live ? `v${live.version}` : '(none published yet)'}`)

if (flags['dry-run']) {
  console.log(`→ Would publish v${target.version} (dry run, nothing sent)\n`)
  process.exit(0)
}

console.log(`→ Publishing v${target.version} ...`)

// publish() resolves to void, so re-read the versions to confirm what went live.
try {
  await client.agent.publish(agentId, {
    version: target.version,
    ...(typeof flags.description === 'string' ? { version_description: flags.description } : {}),
  })
} catch (err) {
  // Retell answers this endpoint with an empty 2xx body and the SDK still
  // JSON.parses it (observed 2026-07-28: publish succeeded, then
  // "Unexpected end of JSON input"). The version re-read below is the real
  // success check, so only rethrow genuine failures.
  if (!(err instanceof SyntaxError)) throw err
}

const after = await versionsNewestFirst()
const nowLive = after.find(v => v.version === target.version)
if (nowLive?.is_published !== true) {
  console.error(
    `\n❌  Publish returned OK but v${target.version} still reads as unpublished. ` +
    'Check the Retell dashboard before dispatching any calls.\n',
  )
  process.exit(1)
}

console.log(`✓ v${target.version} is live`)
console.log(`  webhook_url: ${nowLive.webhook_url ?? '(none set)'}`)
console.log(`  published:   ${after.filter(v => v.is_published === true).map(v => v.version).reverse().join(', ')}\n`)
