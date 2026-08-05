'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import { adminInitials } from '@/lib/admin-activity'
import { pacificDateAtTime, timeAgo } from '@/lib/dates'

/**
 * Admin-to-admin sticky note, pinned under the case header (owner,
 * 2026-08-04).
 *
 * The problem it solves: when a case is still open past its target, the
 * reason ("agent is out until Thursday", "third voicemail, no callback") was
 * only recoverable by opening the case, switching to the AI tab, scrolling to
 * the contact log and reading uniformly-styled prose until the latest
 * outreach attempt turned up. This puts the same sentence at the top of the
 * page in the admin's own words.
 *
 * Plain text, never published, never seen by the customer — the column has no
 * grant to `authenticated` (migration 0039). The queue shows only that a note
 * EXISTS plus a hover preview, so the note stays a note and the queue stays
 * scannable.
 */
export default function AdminNote({ note, at, by, action }: {
  /** Saved note body, '' when there is none. */
  note: string
  /** ISO timestamp of the last save, null when there is no note. */
  at: string | null
  /** Email of the admin who last saved it, '' when unknown. */
  by: string
  action: (formData: FormData) => Promise<{ error?: string } | void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note)
  const [saved, setSaved] = useState(note)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const box = useRef<HTMLTextAreaElement>(null)

  // A save re-renders this with a new `note` from the server; adopt it rather
  // than keeping the stale draft. Adjusting state during render (React's
  // documented pattern) instead of in an effect: no cascading second render.
  if (note !== saved) {
    setSaved(note)
    setDraft(note)
  }
  useEffect(() => { if (editing) box.current?.focus() }, [editing])

  function save(body: string) {
    setError('')
    const fd = new FormData()
    fd.set('note', body)
    startTransition(async () => {
      const res = await action(fd)
      if (res && 'error' in res && res.error) { setError(res.error); return }
      setEditing(false)
    })
  }

  if (!editing && !note) {
    return (
      <button type="button" onClick={() => { setDraft(''); setEditing(true) }} style={addBtn}>
        + Add admin note
      </button>
    )
  }

  return (
    <div style={{
      background: editing ? C.surface : C.marker,
      border: `1px solid ${editing ? C.border : 'transparent'}`,
      borderLeft: `3px solid ${C.limeDeep}`,
      borderRadius: 10, padding: '11px 13px', margin: '0 0 18px', fontFamily: C.sans,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: editing || note ? 6 : 0 }}>
        <span style={{
          fontFamily: C.mono, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.09em',
          textTransform: 'uppercase', color: C.txt2,
        }}>
          Admin note
        </span>
        <span style={{ fontSize: 11.5, color: C.txt3 }}>internal only</span>
        {!editing && at && (
          <span title={`Saved ${pacificDateAtTime(at)}`} style={{ fontSize: 11.5, color: C.txt2, marginLeft: 'auto' }}>
            {by ? `${adminInitials(by)} · ` : ''}{timeAgo(at)}
          </span>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            ref={box}
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, 1000))}
            rows={3}
            placeholder="Why is this still open? e.g. Third voicemail left, agency closed until Monday."
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              fontFamily: C.sans, fontSize: 13.5, lineHeight: 1.5, color: C.txt,
              background: C.paper, border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 10px',
            }}
          />
          <div className="fx-actions" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={() => save(draft.trim())} disabled={pending || draft.trim() === note}
              style={{
                padding: '7px 18px', fontSize: 13, fontWeight: 600, fontFamily: C.sans,
                background: C.earthy, color: C.onDark, border: 'none', borderRadius: 9999,
                cursor: pending || draft.trim() === note ? 'default' : 'pointer',
                opacity: pending || draft.trim() === note ? 0.6 : 1,
              }}>
              {pending ? 'Saving...' : 'Save note'}
            </button>
            <button type="button" onClick={() => { setDraft(note); setEditing(false); setError('') }}
              style={linkBtn}>
              Cancel
            </button>
            {note && (
              <button type="button" onClick={() => save('')} disabled={pending}
                style={{ ...linkBtn, marginLeft: 'auto', color: C.error }}>
                Delete
              </button>
            )}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {/* pre-wrap: the note is plain text and admins write it in lines. */}
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: C.txt, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', flex: 1 }}>
            {note}
          </p>
          <button type="button" onClick={() => setEditing(true)} style={{ ...linkBtn, flexShrink: 0 }}>Edit</button>
        </div>
      )}

      {error && <p style={{ fontSize: 12.5, color: C.error, margin: '8px 0 0' }}>{error}</p>}
    </div>
  )
}

const addBtn = {
  display: 'inline-block', margin: '0 0 18px', padding: '6px 14px',
  fontSize: 12.5, fontWeight: 600, fontFamily: C.sans, color: C.txt2,
  background: C.surface, border: `1px dashed ${C.borderStrong}`, borderRadius: 9999,
  cursor: 'pointer',
}

const linkBtn = {
  padding: '6px 8px', background: 'transparent', border: 'none', borderRadius: 7,
  fontFamily: C.sans, fontSize: 12.5, fontWeight: 600, color: C.txt2, cursor: 'pointer',
}
