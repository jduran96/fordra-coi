'use client'

import { useActionState, useState } from 'react'
import { C } from '@/lib/theme'
import PendingButton from '@/components/PendingButton'
import { createApiKey, revokeApiKey, type CreateKeyState } from '@/app/app/actions'

interface KeyRow {
  id: string
  mode: string
  key_prefix: string
  name: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

/**
 * Self-serve API keys inside the docs page. The full secret is displayed exactly
 * once, right after creation; only the hash is stored, so it can never be shown
 * again. Revoking stops the key authenticating immediately.
 */
const PAGE_SIZE = 2

export default function ApiKeyManager({ keys }: { keys: KeyRow[] }) {
  const [state, formAction] = useActionState<CreateKeyState, FormData>(createApiKey, {})
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(keys.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const visible = keys.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, fontFamily: C.sans }}>
      <form action={formAction} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select name="mode" defaultValue="sandbox" style={{ padding: '8px 11px', fontSize: 13.5, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, background: C.surface, color: C.txt }}>
          <option value="sandbox">Sandbox (sk_test_)</option>
          <option value="live">Live (sk_live_)</option>
        </select>
        <PendingButton pendingLabel="Creating…" style={btn()}>Create key</PendingButton>
      </form>
      {state.secret && <SecretBanner secret={state.secret} />}
      {state.error && <p style={{ fontSize: 13, color: C.error, margin: 0 }}>{state.error}</p>}

      {keys.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: C.txt3, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <th style={th()}>Key</th><th style={th()}>Mode</th><th style={th()}>Created</th><th style={th()}>Last used</th><th style={th()}>Status</th><th style={th()} />
              </tr>
            </thead>
            <tbody>
              {visible.map(k => (
                <tr key={k.id} style={{ borderTop: `1px solid ${C.border}` }}>
                  <td style={{ ...td(), fontFamily: 'ui-monospace, monospace' }}>{k.key_prefix}…</td>
                  <td style={{ ...td(), textTransform: 'capitalize' }}>{k.mode}</td>
                  <td style={td()}>{new Date(k.created_at).toLocaleDateString()}</td>
                  <td style={td()}>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}</td>
                  <td style={td()}>
                    {k.revoked_at
                      ? <span style={{ color: C.txt3 }}>Revoked</span>
                      : <span style={{ color: C.ok, fontWeight: 600 }}>Active</span>}
                  </td>
                  <td style={{ ...td(), textAlign: 'right' }}>
                    {!k.revoked_at && (
                      <form action={revokeApiKey.bind(null, k.id)}>
                        <PendingButton pendingLabel="Revoking…" style={{ ...btn(), color: C.error }}>Revoke</PendingButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <button type="button" aria-label="Previous page" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={current === 0}
                style={{ ...btn(), padding: '4px 12px', opacity: current === 0 ? 0.4 : 1 }}>‹</button>
              <span style={{ fontSize: 12, color: C.txt3 }}>Page {current + 1} of {pageCount}</span>
              <button type="button" aria-label="Next page" onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={current >= pageCount - 1}
                style={{ ...btn(), padding: '4px 12px', opacity: current >= pageCount - 1 ? 0.4 : 1 }}>›</button>
            </div>
          )}
        </div>
      ) : (
        <p style={{ fontSize: 13.5, color: C.txt2, margin: 0 }}>No API keys yet. Create one above.</p>
      )}

      <p style={{ fontSize: 12.5, color: C.txt3, margin: 0, lineHeight: 1.5 }}>
        Keys are shown once and stored hashed. Anyone with a live key can submit verifications for
        your organization; revoke any key you no longer use. Questions: (727) 729-9594.
      </p>
    </div>
  )
}

function SecretBanner({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }
  return (
    <div style={{ background: `color-mix(in oklch, ${C.lime} 30%, ${C.surface})`, border: `1px solid ${C.limeDeep}`, borderRadius: 8, padding: '12px 14px' }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: C.txt, margin: '0 0 8px' }}>
        Your new key. Copy it now: this is the only time it will be shown.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, color: C.txt, wordBreak: 'break-all', userSelect: 'all', flex: 1, minWidth: 240 }}>{secret}</code>
        <button type="button" onClick={copy} style={{ ...btn(), background: copied ? C.lime : C.surface, whiteSpace: 'nowrap' }}>
          {copied ? '✓ Copied' : 'Copy key'}
        </button>
      </div>
    </div>
  )
}

const th = () => ({ padding: '4px 12px 6px 0', fontWeight: 600 as const })
const td = () => ({ padding: '9px 12px 9px 0', color: C.txt2 })
const btn = () => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer' })
