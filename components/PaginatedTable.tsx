'use client'

import { useState } from 'react'
import { C } from '@/lib/theme'

/**
 * Client-side pagination shell shared by the app and admin tables. The server
 * renders the header <tr> and one <tr> per record and passes them in; this
 * shows pageSize rows at a time with a pager pinned bottom-right (hidden when
 * everything fits on one page). Client-side slicing is right for pilot-scale
 * data; if a table ever grows past a few hundred rows, move the slicing into
 * the database query instead of loading everything here.
 */
export default function PaginatedTable({ head, rows, pageSize = 5, maxHeight }: {
  /** The fully-styled header <tr>. */
  head: React.ReactNode
  /** One fully-styled <tr> per record (keyed), in display order. */
  rows: React.ReactNode[]
  pageSize?: number
  /** Caps the table body's height; the current page scrolls inside it. */
  maxHeight?: number
}) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  // Clamp instead of resetting state: a deleted row on the last page must not
  // strand the pager past the end.
  const cur = Math.min(page, pages - 1)
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto', ...(maxHeight ? { maxHeight, overflowY: 'auto' as const } : {}) }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.sans, fontSize: 14 }}>
          <thead>{head}</thead>
          <tbody>{rows.slice(cur * pageSize, (cur + 1) * pageSize)}</tbody>
        </table>
      </div>
      {pages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10,
          padding: '9px 14px', borderTop: `1px solid ${C.border}`, fontFamily: C.sans,
        }}>
          <button type="button" aria-label="Previous page" disabled={cur === 0}
            onClick={() => setPage(cur - 1)}
            style={pagerBtn(cur === 0)}>
            ‹
          </button>
          <span style={{ fontSize: 12, color: C.txt3 }}>Page {cur + 1} of {pages}</span>
          <button type="button" aria-label="Next page" disabled={cur >= pages - 1}
            onClick={() => setPage(cur + 1)}
            style={pagerBtn(cur >= pages - 1)}>
            ›
          </button>
        </div>
      )}
    </div>
  )
}

const pagerBtn = (disabled: boolean) => ({
  width: 26, height: 26, padding: 0, fontSize: 14, lineHeight: 1, fontFamily: C.sans,
  color: C.txt2, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6,
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
})
