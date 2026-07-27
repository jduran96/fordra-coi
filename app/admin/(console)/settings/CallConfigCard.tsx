'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import { DEFAULT_CALL_CONFIG, type OrgCallConfig } from '@/lib/call-config'
import { saveCallConfig } from './actions'

/**
 * AI call identity config editor: the global defaults plus per-org overrides
 * that prefill the pre-dial review screen (everything stays editable per
 * dispatch there). Blank org fields fall back to the global value; blank
 * global fields fall back to the built-in defaults.
 */

const FIELDS: { field: keyof OrgCallConfig; label: string; hint?: string }[] = [
  { field: 'assistant_name', label: 'Assistant name' },
  { field: 'on_behalf_of', label: 'On behalf of', hint: 'The only org name the agent ever speaks' },
  { field: 'relationship_line', label: 'Relationship line' },
  { field: 'holder_legal_name', label: 'Certificate holder (legal name)' },
  { field: 'holder_address', label: 'Certificate holder address' },
  { field: 'reply_email', label: 'Reply email' },
  { field: 'on_behalf_of_info', label: 'About the client (1-2 sentences)' },
]

export default function CallConfigCard({ orgs, global, byOrg }: {
  orgs: { id: string; name: string }[]
  global: Partial<OrgCallConfig>
  byOrg: Record<string, Partial<OrgCallConfig>>
}) {
  const [scope, setScope] = useState<'global' | string>('global')
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const stored = scope === 'global' ? global : (byOrg[scope] ?? {})
  const fallback = scope === 'global' ? DEFAULT_CALL_CONFIG : { ...DEFAULT_CALL_CONFIG, ...global }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Scope</label>
        <select value={scope} onChange={e => { setScope(e.target.value); setMessage(null) }} style={inputStyle}>
          <option value="global">Global default</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      {/* Keyed by scope + stored data so switching scope remounts the fields
          with the right defaults (React 19 stale-defaultValue rule). */}
      <form
        key={`${scope}:${JSON.stringify(stored)}`}
        onSubmit={e => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          fd.set('scope', scope)
          // Language checkboxes -> the comma-separated languages value the
          // Retell payload expects. English is always on.
          fd.set('languages', fd.get('lang_es') ? 'en,es' : 'en')
          fd.delete('lang_es')
          setMessage(null)
          startTransition(async () => {
            const res = await saveCallConfig(fd)
            if (res && 'error' in res && res.error) setMessage({ kind: 'error', text: res.error })
            else setMessage({ kind: 'ok', text: 'Saved.' })
          })
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {FIELDS.map(({ field, label, hint }) => (
            <div key={field}>
              <label style={labelStyle}>{label}</label>
              <input
                name={field}
                defaultValue={stored[field] ?? ''}
                style={inputStyle}
              />
              {hint && <p style={{ fontSize: 11.5, color: C.txt3, margin: '3px 0 0' }}>{hint}</p>}
            </div>
          ))}
          <div>
            <label style={labelStyle}>Languages</label>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', padding: '8px 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: C.txt }}>
                <input type="checkbox" checked readOnly disabled />
                English
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: C.txt, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  name="lang_es"
                  defaultChecked={(stored.languages ?? fallback.languages ?? '').split(',').map(s => s.trim()).includes('es')}
                />
                Spanish
              </label>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Entity type</label>
            <select name="entity_type" defaultValue={stored.entity_type ?? ''} style={inputStyle}>
              <option value="">Use fallback ({fallback.entity_type})</option>
              <option value="agency">Agency</option>
              <option value="carrier">Carrier</option>
              <option value="mga">MGA</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="submit" disabled={pending} style={btnStyle(pending)}>
            {pending ? 'Saving...' : 'Save call config'}
          </button>
          {message && (
            <span style={{ fontSize: 13, fontWeight: 600, color: message.kind === 'error' ? C.error : C.ok }}>{message.text}</span>
          )}
        </div>
      </form>
    </div>
  )
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.txt2, display: 'block', marginBottom: 4 }
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13.5, fontFamily: C.sans, color: C.txt, background: C.surface, borderRadius: 7, border: `1px solid ${C.border}` }
const btnStyle = (pending: boolean): React.CSSProperties => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1 })
