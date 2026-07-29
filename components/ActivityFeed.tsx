'use client'

import { useState } from 'react'
import { C } from '@/lib/theme'
import { pacificDateTime } from '@/lib/dates'
import EditorModal from '@/components/EditorModal'
import type { FeedEntry } from '@/lib/activity-feed'

/**
 * "Activity" pill + popup: a read-only feed of a verification's (or a
 * business's) status history — submissions and report status updates. Distinct
 * from the admin ActivityLog, which is the admin's own outreach bookkeeping;
 * this feed is built from the customer-visible `events` rows.
 */
export default function ActivityFeed({ entries, title = 'Activity' }: {
  entries: FeedEntry[]
  title?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={{
        padding: '8px 18px', fontSize: 13, fontWeight: 600, fontFamily: C.sans,
        borderRadius: 9999, border: `1px solid ${C.border}`, background: 'transparent',
        color: C.txt2, cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
        Activity
      </button>
      {open && (
        <EditorModal title={title} onClose={() => setOpen(false)} maxWidth={520}>
          {entries.length === 0 ? (
            <p style={{ fontSize: 14, color: C.txt3, margin: 0 }}>No activity recorded yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
              {entries.map((e, i) => (
                <li key={i} style={{
                  display: 'flex', alignItems: 'baseline', gap: 12, padding: '10px 2px',
                  borderTop: i === 0 ? 'none' : `1px solid ${C.border}`,
                }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: C.txt }}>{e.label}</span>
                  {e.detail && <span style={{ fontSize: 12.5, color: C.txt3 }}>{e.detail}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 12.5, color: C.txt3, whiteSpace: 'nowrap' }}>
                    {pacificDateTime(e.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </EditorModal>
      )}
    </>
  )
}
