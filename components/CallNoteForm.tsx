'use client'

import { useRef } from 'react'
import { C } from '@/lib/theme'
import PendingButton from '@/components/PendingButton'

/**
 * Add-a-call-note form. Client component so the fields clear after a successful
 * save; the contact inputs re-prefill from the freshly saved contact when the
 * page revalidates.
 */
export default function CallNoteForm({
  action,
  contact,
}: {
  action: (formData: FormData) => Promise<void>
  contact: { name?: string; phone?: string; email?: string }
}) {
  const formRef = useRef<HTMLFormElement>(null)

  async function submit(formData: FormData) {
    await action(formData)
    formRef.current?.reset()
  }

  return (
    <form ref={formRef} action={submit} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8, fontFamily: C.sans }}>
      <input name="contact_name" defaultValue={contact.name} placeholder="Insurer contact name" style={input()} />
      <input name="contact_phone" defaultValue={contact.phone} placeholder="Phone" style={input()} />
      <input name="contact_email" defaultValue={contact.email} placeholder="Email" style={input()} />
      <textarea name="note" rows={4} placeholder="What the insurer confirmed on this call…" style={{ ...input(), resize: 'vertical' }} />
      <PendingButton pendingLabel="Saving…" style={{ ...btn(), alignSelf: 'flex-start', marginTop: 2 }}>Save note</PendingButton>
    </form>
  )
}

const input = () => ({ padding: '9px 11px', fontSize: 14, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box' as const })
const btn = () => ({ padding: '7px 13px', background: C.surface, color: C.txt, fontSize: 13, fontWeight: 600 as const, fontFamily: C.sans, borderRadius: 7, border: `1px solid ${C.border}`, cursor: 'pointer' })
