'use client'

import { useState } from 'react'
import { C } from '@/lib/theme'
import PendingButton from '@/components/PendingButton'
import EditorModal from '@/components/EditorModal'

/**
 * "Log a call" button that opens the add-a-call-note dialog. The dialog keeps
 * whatever was typed if it is closed without saving (accidental Escape or
 * backdrop click must not lose a call write-up); fields clear only after a
 * successful save, when the new note appears in the Saved notes table.
 * Leaving the contact fields blank keeps the previously saved insurer contact
 * (the action only updates it when a field is filled).
 */
export default function CallNoteForm({
  action,
}: {
  action: (formData: FormData) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')

  async function submit(formData: FormData) {
    await action(formData)
    setName('')
    setPhone('')
    setEmail('')
    setNote('')
    setOpen(false)
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={{
        alignSelf: 'flex-start', padding: '8px 16px', background: C.surface, color: C.txt,
        fontSize: 13, fontWeight: 600, fontFamily: C.sans, borderRadius: 7,
        border: `1px solid ${C.border}`, cursor: 'pointer',
      }}>
        Log a call
      </button>
      {open && (
        <EditorModal title="Log a call" onClose={() => setOpen(false)} maxWidth={520}>
          <form action={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: C.sans }}>
            <input name="contact_name" value={name} onChange={e => setName(e.target.value)} placeholder="Insurer contact name" style={input()} />
            <input name="contact_phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" style={input()} />
            <input name="contact_email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" style={input()} />
            <textarea name="note" value={note} onChange={e => setNote(e.target.value)} rows={5} placeholder="What the insurer confirmed on this call…" style={{ ...input(), resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <PendingButton pendingLabel="Saving…" style={{
                padding: '8px 20px', background: C.txt, color: C.onDark, fontSize: 13, fontWeight: 600,
                fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: 'pointer',
              }}>
                Save note
              </PendingButton>
              <button type="button" onClick={() => setOpen(false)} style={{
                padding: '8px 14px', background: 'transparent', color: C.txt2, fontSize: 13, fontWeight: 600,
                fontFamily: C.sans, borderRadius: 7, border: 'none', cursor: 'pointer',
              }}>
                Cancel
              </button>
            </div>
          </form>
        </EditorModal>
      )}
    </>
  )
}

const input = () => ({ padding: '9px 11px', fontSize: 14, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box' as const })
