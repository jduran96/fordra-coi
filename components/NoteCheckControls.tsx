'use client'

import { useState } from 'react'
import { C } from '@/lib/theme'
import PendingButton from '@/components/PendingButton'
import type { NoteContactCheck, OnlineListingStatus } from '@/lib/types'

const STATUS_OPTIONS: { value: OnlineListingStatus; label: string }[] = [
  { value: 'verified', label: 'Verified online' },
  { value: 'not_found', label: 'Not found online' },
  { value: 'differs', label: 'Differs from online' },
]

/**
 * Admin controls for ONE contact log's web verification: run (or re-run) the
 * online check for the phone/email cited in that log, and once a result
 * exists, edit the per-field statuses and the customer-facing blurb. Selects
 * render only for fields the check actually covered — a blank field is never
 * checked and never gets a status.
 */
export default function NoteCheckControls({
  check,
  hasContactField,
  runAction,
  saveAction,
}: {
  check: NoteContactCheck | null
  /** The log cites at least one of phone/email (otherwise nothing to check). */
  hasContactField: boolean
  runAction: () => Promise<{ error?: string } | void>
  saveAction: (formData: FormData) => Promise<{ error?: string } | void>
}) {
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  async function run() {
    setError('')
    const res = await runAction()
    if (res?.error) setError(res.error)
  }

  async function save(formData: FormData) {
    setError('')
    const res = await saveAction(formData)
    if (res?.error) {
      setError(res.error)
      return
    }
    setEditing(false)
  }

  if (!hasContactField) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <form action={run} style={{ margin: 0 }}>
          <PendingButton pendingLabel="Checking the web… (can take a minute)" style={btn()}>
            {check ? 'Re-run online check' : 'Run online check'}
          </PendingButton>
        </form>
        {check && !editing && (
          <button type="button" onClick={() => setEditing(true)} style={{ ...btn(), border: 'none', background: 'transparent', color: C.txt2 }}>
            Edit
          </button>
        )}
      </div>
      {check && editing && (
        <form action={save} style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: C.sans }}>
          <div style={{ display: 'flex', gap: 10 }}>
            {check.phone_status && (
              <label style={label()}>
                Phone status
                <select name="phone_status" defaultValue={check.phone_status} style={input()}>
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            )}
            {check.email_status && (
              <label style={label()}>
                Email status
                <select name="email_status" defaultValue={check.email_status} style={input()}>
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            )}
          </div>
          <label style={label()}>
            Customer blurb
            <textarea name="blurb" defaultValue={check.blurb} rows={3}
              placeholder="A couple of sentences about what the web search turned up"
              style={{ ...input(), resize: 'vertical' as const }} />
          </label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <PendingButton pendingLabel="Saving…" style={btn()}>Save</PendingButton>
            <button type="button" onClick={() => setEditing(false)} style={{ ...btn(), border: 'none', background: 'transparent', color: C.txt2 }}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p style={{ fontSize: 13, color: C.error, margin: 0 }}>{error}</p>}
    </div>
  )
}

const btn = () => ({ padding: '6px 12px', background: C.surface, color: C.txt, fontSize: 12.5, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer' })
const input = () => ({ padding: '7px 9px', fontSize: 13, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box' as const, width: '100%', marginTop: 4 })
const label = () => ({ display: 'flex', flexDirection: 'column' as const, fontSize: 11, fontWeight: 600 as const, color: C.txt3, textTransform: 'uppercase' as const, letterSpacing: '0.5px', flex: 1 })
