'use client'

import { useState } from 'react'
import { C } from '@/lib/theme'
import PendingButton from '@/components/PendingButton'
import type { ExternalConfirmation, NoteContactCheck, OnlineListingStatus, WebsiteStatus } from '@/lib/types'

const STATUS_OPTIONS: { value: OnlineListingStatus; label: string }[] = [
  { value: 'verified', label: 'Verified online' },
  { value: 'not_found', label: 'Not found online' },
  { value: 'differs', label: 'Differs from online' },
]

const WEBSITE_OPTIONS: { value: WebsiteStatus; label: string }[] = [
  { value: 'aligns', label: 'Site matches logged info' },
  { value: 'not_found', label: 'No official site found' },
  { value: 'differs', label: 'Site shows different info' },
]

const EXTERNAL_OPTIONS: { value: ExternalConfirmation; label: string }[] = [
  { value: 'confirmed', label: 'Confirmed by outside source' },
  { value: 'not_confirmed', label: 'No outside confirmation' },
]

/**
 * Admin edit controls for one stored contact verification result: flip the
 * per-field statuses and reword the customer-facing blurb. Used on contact
 * log snapshots AND on online-check history entries (only the bound save
 * action differs). Selects render only for fields the check actually covered
 * — a blank field is never checked and never gets a status. Web checks run
 * elsewhere (the single online-check task); this component never searches.
 */
export default function NoteCheckControls({
  check,
  saveAction,
}: {
  check: NoteContactCheck | null
  saveAction: (formData: FormData) => Promise<{ error?: string } | void>
}) {
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  async function save(formData: FormData) {
    setError('')
    const res = await saveAction(formData)
    if (res?.error) {
      setError(res.error)
      return
    }
    setEditing(false)
  }

  if (!check) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      {!editing && (
        <div>
          <button type="button" onClick={() => setEditing(true)} style={{ ...btn(), border: 'none', background: 'transparent', color: C.txt2, padding: '2px 0' }}>
            Edit
          </button>
        </div>
      )}
      {editing && (
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
          {/* Agency-level findings exist only on checks run after the
              two-pronged rework; the derived legitimacy verdict re-computes
              server-side on save and is never edited directly. */}
          {(check.website_status || check.external_confirmation) && (
            <div style={{ display: 'flex', gap: 10 }}>
              {check.website_status && (
                <label style={label()}>
                  Their website
                  <select name="website_status" defaultValue={check.website_status} style={input()}>
                    {WEBSITE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
              {check.external_confirmation && (
                <label style={label()}>
                  Outside source
                  <select name="external_confirmation" defaultValue={check.external_confirmation} style={input()}>
                    {EXTERNAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
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
