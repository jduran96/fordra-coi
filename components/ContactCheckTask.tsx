'use client'

import { useState } from 'react'
import { C } from '@/lib/theme'
import PendingButton from '@/components/PendingButton'

/**
 * The single entry point for online contact verification: phone/email inputs
 * prefilled from the COI's extracted producer contact (editable, so the admin
 * can check a number an insurer gave them instead), and a manually triggered
 * web check. Results accumulate in the verification's check history; contact
 * logs inherit tags by matching against it — this form is the only thing
 * that ever spends web-search tokens.
 *
 * Controlled inputs on purpose: after a run the values stay put so the admin
 * can tweak one field and re-run (and React 19 resets defaultValue-only
 * inputs after a server action anyway).
 */
export default function ContactCheckTask({
  defaultPhone,
  defaultEmail,
  runAction,
}: {
  defaultPhone: string
  defaultEmail: string
  runAction: (formData: FormData) => Promise<{ error?: string } | void>
}) {
  const [phone, setPhone] = useState(defaultPhone)
  const [email, setEmail] = useState(defaultEmail)
  const [error, setError] = useState('')

  async function run(formData: FormData) {
    setError('')
    const res = await runAction(formData)
    if (res?.error) setError(res.error)
  }

  return (
    <form action={run} style={{ display: 'flex', flexDirection: 'column', gap: 10, fontFamily: C.sans }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
        <label style={label()}>
          Phone
          <input name="phone" value={phone} onChange={e => setPhone(e.target.value)}
            placeholder="Phone to verify" style={input()} />
        </label>
        <label style={label()}>
          Email
          <input name="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email to verify" style={input()} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <PendingButton pendingLabel="Checking the web… (can take a minute)" style={btn()}>
          Check phone/email online
        </PendingButton>
        <span style={{ fontSize: 12, color: C.txt3 }}>
          Runs a web search against the producer on the COI. Logs citing a checked value pick up its tag automatically.
        </span>
      </div>
      {error && <p style={{ fontSize: 13, color: C.error, margin: 0 }}>{error}</p>}
    </form>
  )
}

const btn = () => ({ padding: '6px 12px', background: C.surface, color: C.txt, fontSize: 12.5, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer' })
const input = () => ({ padding: '7px 9px', fontSize: 13, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box' as const, width: '100%', marginTop: 4 })
const label = () => ({ display: 'flex', flexDirection: 'column' as const, fontSize: 11, fontWeight: 600 as const, color: C.txt3, textTransform: 'uppercase' as const, letterSpacing: '0.5px', flex: 1, minWidth: 200 })
