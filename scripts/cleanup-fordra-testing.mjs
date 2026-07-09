/**
 * One-off cleanup (2026-07-09): delete the Fordra Testing org's test data —
 * verifications, their documents rows and storage objects, plus two orphaned
 * slack-intake temp objects left by Slack testing. Users and orgs are kept.
 * Run: node scripts/cleanup-fordra-testing.mjs   — then delete this file.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')])
)
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: org, error: oerr } = await svc.from('orgs').select('id, name').eq('name', 'Fordra Testing').single()
if (oerr) throw oerr
console.log('org:', org.name, org.id)

const { data: verifs, error: verr } = await svc.from('verifications')
  .select('id, display_id, carrier_name').eq('org_id', org.id)
if (verr) throw verr
console.log('verifications:', verifs.length)
for (const v of verifs) console.log('  -', v.display_id ?? v.id, `(${v.carrier_name ?? 'no carrier'})`)
const vIds = verifs.map(v => v.id)

let paths = []
if (vIds.length) {
  const { data: docs, error } = await svc.from('documents').select('storage_path').in('verification_id', vIds)
  if (error) throw error
  paths = docs.map(d => d.storage_path).filter(Boolean)
}
// the org's whole storage folder, in case any object has no documents row
async function walk(prefix) {
  const { data } = await svc.storage.from('documents').list(prefix, { limit: 1000 })
  for (const f of data ?? []) {
    const p = `${prefix}/${f.name}`
    if (f.id) paths.push(p); else await walk(p)
  }
}
await walk(org.id)
// orphaned slack-intake temp objects (verified: no intake session references them)
paths.push(
  'slack-intake/5211f6ca-2dfe-491b-ba49-4fd53d05d204/coi-Sample_COI.pdf',
  'slack-intake/d37a9050-a2c3-4639-9b90-5fb72aec62f7/coi-Sample_COI.pdf',
)
paths = [...new Set(paths)]
console.log('storage objects to remove:', paths.length)
for (const p of paths) console.log('  -', p)

const { error: rerr } = await svc.storage.from('documents').remove(paths)
if (rerr) throw rerr
console.log('storage removed')

if (vIds.length) {
  const { error: derr } = await svc.from('documents').delete().in('verification_id', vIds)
  if (derr) throw derr
  const { error: eerr } = await svc.from('events').delete().eq('org_id', org.id)
  if (eerr) console.error('events delete:', eerr.message)
  const { error: vderr } = await svc.from('verifications').delete().in('id', vIds)
  if (vderr) throw vderr
  console.log('deleted', vIds.length, 'verifications + their documents rows')
}
console.log('Done. Users and orgs untouched.')
