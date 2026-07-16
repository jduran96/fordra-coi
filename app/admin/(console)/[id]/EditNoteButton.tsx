'use client'

import { useState } from 'react'
import { C } from '@/lib/theme'
import type { ContactNote } from '@/lib/types'
import PendingButton from '@/components/PendingButton'
import EditorModal from '@/components/EditorModal'
import RichTextInput from '@/components/RichTextInput'

/**
 * Per-note Edit button (next to Delete) opening the contact-note dialog
 * PREFILLED from the saved note — including the contact name/phone/email, so
 * the verified values are visible inside the popup itself instead of hidden
 * behind it. Same persist-on-error contract as CallNoteForm: closing without
 * saving keeps the edits; state only resets via the remount key on fresh data
 * after a successful save (repeat-bugs #15). Legacy { text } notes prefill
 * the summary editor, so their content survives an edit as summary_html.
 */
export default function EditNoteButton({ note, action }: {
  note: ContactNote
  action: (formData: FormData) => Promise<{ error?: string } | void>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(note.contact?.name ?? '')
  const [phone, setPhone] = useState(note.contact?.phone ?? '')
  const [email, setEmail] = useState(note.contact?.email ?? '')
  const [method, setMethod] = useState(note.contact_method ?? '')
  const [summary, setSummary] = useState(
    note.summary_html ?? plainToHtml(note.summary_text || note.text || ''),
  )
  const [transcript, setTranscript] = useState(note.transcript ?? '')
  const [error, setError] = useState('')

  async function submit(formData: FormData) {
    setError('')
    const res = await action(formData)
    if (res?.error) {
      setError(res.error)
      return
    }
    setOpen(false)
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Edit this note" style={{
        padding: '4px 10px', fontSize: 12, fontWeight: 600, fontFamily: C.sans,
        borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent',
        color: C.txt3, cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
        Edit
      </button>
      {open && (
        <EditorModal title="Edit contact note" onClose={() => setOpen(false)} maxWidth={640}>
          <form action={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: C.sans }}>
            <input name="contact_name" value={name} onChange={e => setName(e.target.value)} placeholder="Insurer contact name" style={input()} />
            <input name="contact_phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" style={input()} />
            <input name="contact_email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" style={input()} />
            <input name="contact_method" value={method} onChange={e => setMethod(e.target.value)} placeholder="Contact method (email, text, call)" style={input()} />
            <label style={label()}>Summary</label>
            <RichTextInput name="summary_html" value={summary} onChange={setSummary} />
            <label style={label()}>Transcript</label>
            <textarea name="transcript" value={transcript} onChange={e => setTranscript(e.target.value)} rows={5} placeholder="Paste the raw transcript (optional)" style={{ ...input(), resize: 'vertical' }} />
            {error && <p style={{ fontSize: 13, color: C.error, margin: 0 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
              <PendingButton pendingLabel="Saving…" style={{
                padding: '8px 20px', background: C.txt, color: C.onDark, fontSize: 13, fontWeight: 600,
                fontFamily: C.sans, borderRadius: 9999, border: 'none', cursor: 'pointer',
              }}>
                Save changes
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

/** Legacy plain-text note body -> minimal paragraphs the rich editor accepts. */
function plainToHtml(text: string): string {
  const t = text.trim()
  if (!t) return ''
  return t.split(/\n+/).map(line =>
    `<p>${line.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</p>`,
  ).join('')
}

const input = () => ({ padding: '9px 11px', fontSize: 14, fontFamily: C.sans, border: `1px solid ${C.border}`, borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box' as const })
const label = () => ({ fontSize: 12, fontWeight: 600 as const, color: C.txt3, textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginTop: 4 })
