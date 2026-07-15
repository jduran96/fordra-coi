'use client'

import { useState, useTransition } from 'react'
import { C } from '@/lib/theme'
import { pacificDateTime } from '@/lib/dates'
import { ACTIVITY_KINDS, summarizeActivity, type AdminActivityEntry } from '@/lib/admin-activity'

/**
 * Top-right admin activity log on the detail page: replaces the old fixed
 * "who called" dropdown, which only remembered the last action. The pill
 * shows the rollup ("3 voicemails over 3 days · 1 call"); the panel logs a
 * new timestamped entry (kind + optional note; the time and admin initials
 * are stamped server-side) and lists the history. Internal bookkeeping only,
 * never shown to customers.
 */
export default function ActivityLog({ entries, logAction, deleteAction }: {
  entries: AdminActivityEntry[]
  logAction: (formData: FormData) => Promise<{ error?: string } | void>
  deleteAction: (entryAt: string) => Promise<{ error?: string } | void>
}) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  const summary = summarizeActivity(entries)
  const kindLabel = (k: string) => ACTIVITY_KINDS.find(x => x.value === k)?.pill ?? k

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
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button type="button" onClick={() => setOpen(o => !o)}
        title="Admin activity log (not visible to the customer)"
        style={{
          fontSize: 12, fontWeight: 600, fontFamily: C.sans, color: C.txt2,
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20,
          padding: '4px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
        {summary || 'Log activity'} {open ? '▴' : '▾'}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 20, width: 360,
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
          padding: 14, boxShadow: '0 8px 28px rgba(0,0,0,0.10)', fontFamily: C.sans,
          display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left',
        }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={kind} onChange={e => setKind(e.target.value)} disabled={pending}
              style={{ ...field(), width: 148, flexShrink: 0 }}>
              <option value="">What happened?</option>
              {ACTIVITY_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <input value={note} onChange={e => setNote(e.target.value)} disabled={pending}
              placeholder="Optional note" style={{ ...field(), flex: 1, minWidth: 0 }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); log() } }} />
            <button type="button" onClick={log} disabled={pending}
              style={{
                padding: '7px 12px', fontSize: 12.5, fontWeight: 600, fontFamily: C.sans,
                background: C.earthy, color: C.onDark, border: 'none', borderRadius: 7,
                cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.65 : 1, flexShrink: 0,
              }}>
              Log
            </button>
          </div>
          {error && <span style={{ fontSize: 11.5, color: C.error }}>{error}</span>}

          {summary && (
            <div style={{ fontSize: 12, color: C.txt2, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
              {summary}
            </div>
          )}

          {entries.length === 0 ? (
            <span style={{ fontSize: 12.5, color: C.txt3 }}>Nothing logged yet. Every entry records the time and who logged it.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 260, overflowY: 'auto' }}>
              {entries.slice().reverse().map((e, i) => (
                <div key={`${e.at}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                    color: C.txt2, background: C.paper, border: `1px solid ${C.border}`,
                    borderRadius: 4, padding: '1.5px 6px', flexShrink: 0,
                  }}>
                    {kindLabel(e.kind)}
                  </span>
                  <span style={{ color: C.txt3, whiteSpace: 'nowrap', flexShrink: 0 }}>{pacificDateTime(e.at)}</span>
                  <span style={{ color: C.txt2, flexShrink: 0 }}>{e.by}</span>
                  {e.note && <span style={{ color: C.txt, overflowWrap: 'anywhere' }}>{e.note}</span>}
                  <button type="button" onClick={() => remove(e.at)} disabled={pending} title="Delete this entry"
                    style={{
                      marginLeft: 'auto', flexShrink: 0, width: 20, height: 20, padding: 0, lineHeight: 1,
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
      )}
    </span>
  )
}

const field = () => ({
  padding: '7px 9px', fontSize: 12.5, fontFamily: C.sans, border: `1px solid ${C.border}`,
  borderRadius: 7, outline: 'none', background: C.surface, color: C.txt, boxSizing: 'border-box' as const,
})
