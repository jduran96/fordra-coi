/**
 * Fordra — migration runner
 *
 * Applies every supabase/migrations/*.sql file in order against the Supabase
 * Postgres database. Each file runs inside a transaction.
 *
 * Connection string resolution (first that is set wins):
 *   SUPABASE_DB_URL  →  DATABASE_URL
 * Use the Supabase "Session" pooler or direct connection string from
 * Dashboard → Project Settings → Database → Connection string.
 *
 * Usage:  node scripts/migrate.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

// load .env.local without a dependency
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
try {
  for (const line of readFileSync(join(root, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env.local — rely on real env */ }

const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error(
    '\n❌  No database URL. Set SUPABASE_DB_URL (or DATABASE_URL) in .env.local to the\n' +
    '    Supabase Postgres connection string (Dashboard → Project Settings → Database).\n',
  )
  process.exit(1)
}
if (connectionString.includes('prisma.io')) {
  console.error(
    '\n❌  DATABASE_URL points at Prisma Postgres, not Supabase. Phase A schema + RLS must\n' +
    '    live in the Supabase database. Set SUPABASE_DB_URL to the Supabase connection string.\n',
  )
  process.exit(1)
}

const dir = join(root, 'supabase', 'migrations')
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

const host = (() => { try { return new URL(connectionString.replace(/^postgres/, 'http')).host } catch { return '(unknown host)' } })()
console.log(`\n→ Connecting to ${host}`)
await client.connect()
console.log('✓ Connected\n')

for (const file of files) {
  const sql = readFileSync(join(dir, file), 'utf8')
  process.stdout.write(`→ ${file} ... `)
  try {
    await client.query('begin')
    await client.query(sql)
    await client.query('commit')
    console.log('done')
  } catch (err) {
    await client.query('rollback')
    console.error('FAILED\n', err.message)
    await client.end()
    process.exit(1)
  }
}

await client.end()
console.log('\n✓ All migrations applied.\n')
