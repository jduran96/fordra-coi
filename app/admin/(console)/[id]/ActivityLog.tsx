'use client'

import { useEffect, useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import { pacificDateTime } from '@/lib/dates'
import { ACTIVITY_KINDS, summarizeActivity, type AdminActivityEntry } from '@/lib/admin-activity'

/**
 * Top-right admin activity log on the detail page: replaces the old fixed
 * "who called" dropdown, which only remembered the last action. The pill
 * shows the rollup ("3 voicemails over 3 days · 1 call"); clicking it opens
 * a centered modal that logs a new timestamped entry (kind + optional note;
 * the time and admin initials are stamped server-side) and lists the history.
 * Internal bookkeeping only, never shown to customers.
 */
export default function ActivityLog({ entries, logAction, deleteAction }: {
  entries: AdminActivityEntry[]
  logAction: (formData: FormData) => Promise<{ error?: string } | void>
  deleteAction: (entryAt: string) => Promise<{ error?: string } | void>
}) {
  const [open, setOpen] = useState(false)
  const summary = summarizeActivity(entries)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        title="Admin activity log (not visible to the customer)"
        style={{
          fontSize: 12, fontWeight: 600, fontFamily: C.sans, color: C.txt2,
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20,
          padding: '4px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
        {summary || 'Log activity'}
      </button>

      {open && (
        <ActivityDialog
          entries={entries}
          summary={summary}
          logAction={logAction}
          deleteAction={deleteAction}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function ActivityDialog({ entries, summary, logAction, deleteAction, onClose }: {
  entries: AdminActivityEntry[]
  summary: string
  logAction: (formData: FormData) => Promise<{ error?: string } | void>
  deleteAction: (entryAt: string) => Promise<{ error?: string } | void>
  onClose: () => void
}) {
  const [kind, setKind] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  const kindLabel = (k: string) => ACTIVITY_KINDS.find(x => x.value === k)?.pill ?? k

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function log() {
    if (!kind) { setError('Pick what happened.'); return }
    setError('')
    const fd = new FormData()
    fd.set('kind', kind)
    fd.set('note', note)
    startTransition(async () => {
      const res = await logAction(fd)
      if (res?.error) { setError(res.error); return }
      setKind('')
      setNote('')
    })
  }
  function remove(at: string) {
    setError('')
    startTransition(async () => {
      const res = await deleteAction(at)
      if (res?.error) setError(res.error)
    })
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }} style={overlay}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontFamily: C.serif, fontSize: 22, fontWeight: 400, color: C.txt, margin: 0 }}>Activity log</h2>
          <button onClick={onClose} aria-label="Close" style={closeBtn}>×</button>
        </div>
        <p style={{ fontSize: 13, color: C.txt3, fontFamily: C.sans, margin: '0 0 16px' }}>
          Admin bookkeeping only. Not visible to the customer.
        </p>

        <div style={{ display: 'flex', gap: 8 }}>
          <select value={kind} onChange={e => setKind(e.target.value)} disabled={pending}
            style={{ ...field(), width: 170, flexShrink: 0 }}>
            <option value="">What happened?</option>
            {ACTIVITY_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <input value={note} onChange={e => setNote(e.target.value)} disabled={pending}
            placeholder="Optional note" style={{ ...field(), flex: 1, minWidth: 0 }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); log() } }} />
          <button type="button" onClick={log} disabled={pending}
            style={{
              padding: '8px 16px', fontSize: 13, fontWeight: 600, fontFamily: C.sans,
              background: C.earthy, color: C.onDark, border: 'none', borderRadius: 9999,
              cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1, flexShrink: 0,
            }}>
            Log
          </button>
        </div>
        {error && <p style={{ fontSize: 12, color: C.error, fontFamily: C.sans, margin: '8px 0 0' }}>{error}</p>}

        {summary && (
          <div style={{ fontSize: 12.5, color: C.txt2, fontFamily: C.sans, margin: '16px 0 0', paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>
            {summary}
          </div>
        )}

        {entries.length === 0 ? (
          <p style={{ fontSize: 13, color: C.txt3, fontFamily: C.sans, margin: '16px 0 0' }}>
            Nothing logged yet. Every entry records the time and who logged it.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12, maxHeight: '50vh', overflowY: 'auto', fontFamily: C.sans }}>
            {entries.slice().reverse().map((e, i) => (
              <div key={`${e.at}-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 13 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                  color: C.txt2, background: C.paper, border: `1px solid ${C.border}`,
                  borderRadius: 4, padding: '1.5px 6px', flexShrink: 0, width: 58, textAlign: 'center',
                }}>
                  {kindLabel(e.kind)}
                </span>
                <span style={{ color: C.txt3, whiteSpace: 'nowrap', flexShrink: 0 }}>{pacificDateTime(e.at)}</span>
                <span style={{ color: C.txt2, flexShrink: 0 }}>{e.by}</span>
                <span style={{ color: C.txt, overflowWrap: 'anywhere', flex: 1 }}>{e.note ?? ''}</span>
                <button type="button" onClick={() => remove(e.at)} disabled={pending} title="Delete this entry"
                  style={{
                    flexShrink: 0, width: 20, height: 20, padding: 0, lineHeight: 1,
                    fontSize: 12, color: C.txt3, background: 'transparent',
                    border: `1px solid ${C.border}`, borderRadius: 5, cursor: 'pointer',
                  }}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const field = () => ({
  padding: '8px 10px', fontSize: 13, fontFamily: C.sans, border: `1px solid ${C.border}`,
  borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box' as const,
})
const overlay = { position: 'fixed' as const, inset: 0, background: 'rgba(20,20,19,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 24 }
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, width: '100%', maxWidth: 680, boxShadow: '0 25px 50px -12px rgba(20,20,19,0.25)' }
const closeBtn = { width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.paper, border: 'none', color: C.txt3, fontSize: 20, cursor: 'pointer', borderRadius: 9999, lineHeight: 1 }
