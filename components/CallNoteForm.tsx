'use client'

import { useState } from 'react'
import { C } from '@/lib/theme'
import PendingButton from '@/components/PendingButton'

/**
 * Add-a-call-note form. Inputs are controlled and cleared after a successful
 * save, so the next note starts from a blank form. The saved contact still
 * lives in the Saved notes table and in insurance_contact; leaving the contact
 * fields blank on a later save keeps the previously saved contact (the action
 * only updates it when a field is filled).
 */
export default function CallNoteForm({
  action,
  contact,
}: {
  action: (formData: FormData) => Promise<void>
  contact: { name?: string; phone?: string; email?: string }
}) {
  const [name, setName] = useState(contact.name ?? '')
  const [phone, setPhone] = useState(contact.phone ?? '')
  const [email, setEmail] = useState(contact.email ?? '')
  const [note, setNote] = useState('')

  async function submit(formData: FormData) {
    await action(formData)
    setName('')
    setPhone('')
    setEmail('')
    setNote('')
  }

  return (
    <form action={submit} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8, fontFamily: C.sans }}>
      <input name="contact_name" value={name} onChange={e => setName(e.target.value)} placeholder="Insurer contact name" style={input()} />
      <input name="contact_phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" style={input()} />
      <input name="contact_email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" style={input()} />
      <textarea name="note" value={note} onChange={e => setNote(e.target.value)} rows={4} placeholder="What the insurer confirmed on this call…" style={{ ...input(), resize: 'vertical' }} />
      <PendingButton pendingLabel="Saving…" style={{ ...btn(), alignSelf: 'flex-start', marginTop: 2 }}>Save note</PendingButton>
    </form>
  )
}

const input = () => ({ padding: '9px 11px', fontSize: 14, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box' as const })
const btn = () => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer' })
