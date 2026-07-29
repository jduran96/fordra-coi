'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import { DEFAULT_CALL_CONFIG, type OrgCallConfig } from '@/lib/call-config'
import { saveCallConfig } from './actions'

/**
 * AI call identity config editor, per org (owner call 2026-07-29: no global
 * scope; every call has different context, so identity is always configured
 * per org). The fields prefill the pre-dial review screen and stay editable
 * per dispatch there. Blank fields fall back to the built-in defaults at read
 * time. The form renders only once an org is picked.
 */

// Identity: who the agent is. Legitimacy: who it is affiliated with and what
// they do. Deal facts (certificate holder, addresses) are per-COI reference
// details on the pre-dial screen, never org config.
const LEGITIMACY_FIELDS: { field: keyof OrgCallConfig; label: string; hint?: string }[] = [
  { field: 'on_behalf_of', label: 'On behalf of', hint: 'The only org name the agent ever speaks' },
  {
    field: 'relationship_line', label: 'Relationship to the deal',
    hint: 'Completes "<On behalf of> is ..." when the office asks why we are calling, e.g. "the certificate holder, extending credit to the policyholder" or "the lender financing the insured equipment"',
  },
  {
    field: 'on_behalf_of_info', label: 'What the client does',
    hint: '1-2 sentences the agent says if the office asks who <On behalf of> is',
  },
  { field: 'reply_email', label: 'Reply email', hint: 'Offered only if the office asks to verify by email' },
]

export default function CallConfigCard({ orgs, byOrg }: {
  orgs: { id: string; name: string }[]
  byOrg: Record<string, Partial<OrgCallConfig>>
}) {
  const [scope, setScope] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)
  const [pending, startTransition] = useTransition()

  const stored = scope ? (byOrg[scope] ?? {}) : {}

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div>
        <label style={labelStyle}>Org</label>
        <select value={scope} onChange={e => { setScope(e.target.value); setMessage(null) }} style={inputStyle}>
          <option value="">Pick an org</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>
      {scope && (
        /* Keyed by scope + stored data so switching orgs remounts the fields
           with the right defaults (React 19 stale-defaultValue rule). */
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
          style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}
        >
          {/* Identity: who the agent is. */}
          <div>
            <p style={sectionTitleStyle}>Identity</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Assistant first name</label>
                <input name="assistant_name" defaultValue={stored.assistant_name ?? ''} style={inputStyle} />
                <p style={hintStyle}>The name the agent introduces itself with</p>
              </div>
              <div>
                <label style={labelStyle}>Assistant last name</label>
                <input name="assistant_last_name" defaultValue={stored.assistant_last_name ?? ''} style={inputStyle} />
                <p style={hintStyle}>Given when a rep asks for a first and last name</p>
              </div>
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
                      defaultChecked={(stored.languages ?? DEFAULT_CALL_CONFIG.languages ?? '').split(',').map(s => s.trim()).includes('es')}
                    />
                    Spanish
                  </label>
                </div>
              </div>
            </div>
          </div>
          {/* Legitimacy: who the agent is affiliated with and what they do. */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <p style={sectionTitleStyle}>Legitimacy</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {LEGITIMACY_FIELDS.map(({ field, label, hint }) => (
                <div key={field}>
                  <label style={labelStyle}>{label}</label>
                  <input
                    name={field}
                    defaultValue={stored[field] ?? ''}
                    style={inputStyle}
                  />
                  {hint && <p style={hintStyle}>{hint}</p>}
                </div>
              ))}
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
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: C.txt2, display: 'block', marginBottom: 4 }
const hintStyle: React.CSSProperties = { fontSize: 11.5, color: C.txt3, margin: '3px 0 0' }
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
  color: C.txt3, margin: '0 0 10px',
}
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13.5, fontFamily: C.sans, color: C.txt, background: C.surface, borderRadius: 7, border: `1px solid ${C.border}` }
const btnStyle = (pending: boolean): React.CSSProperties => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1 })
