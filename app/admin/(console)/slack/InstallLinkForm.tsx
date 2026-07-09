'use client'

import { useActionState } from 'react'
import { C } from '@/lib/theme'
import { generateInstallLink } from './actions'

export default function InstallLinkForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(generateInstallLink, {})

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
      <form action={formAction} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          name="org_id"
          defaultValue=""
          style={{ fontFamily: C.sans, fontSize: 14, padding: '9px 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.paper, color: C.txt }}
        >
          <option value="" disabled>Choose an org…</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <button
          type="submit"
          disabled={pending}
          style={{ fontFamily: C.sans, fontSize: 14, fontWeight: 600, padding: '9px 18px', borderRadius: 999, border: 'none', background: C.ink, color: C.paper, cursor: 'pointer' }}
        >
          {pending ? 'Generating…' : 'Generate install link'}
        </button>
      </form>
      {state.error && <p style={{ color: '#b3261e', fontSize: 13, margin: '12px 0 0' }}>{state.error}</p>}
      {state.url && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13, color: C.txt3, margin: '0 0 6px' }}>
            Send this to the partner (valid 7 days). Anyone with the link can connect their workspace to this org.
          </p>
          <code style={{ fontFamily: C.mono, fontSize: 12, wordBreak: 'break-all', display: 'block', background: C.paper, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px' }}>
            {state.url}
          </code>
        </div>
      )}
    </div>
  )
}
