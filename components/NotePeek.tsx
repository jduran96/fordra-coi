'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { C } from '@/lib/theme'
import { adminInitials } from '@/lib/admin-activity'
import { timeAgo } from '@/lib/dates'

/**
 * Queue indicator for a verification's admin sticky note (owner, 2026-08-04):
 * the note body stays OUT of the table — a queue full of paragraphs stops
 * being scannable — and this badge marks the rows that have one. Hovering it
 * (or tapping, on a phone) shows the note attached to its own row.
 *
 * The popover is `position: fixed` rather than absolute because the table body
 * is an `overflow-x: auto` scroller: an absolutely positioned bubble would be
 * clipped by it. Click toggles as well as hover, so it works on touch, and the
 * badge keeps a native `title` so the note is still reachable if the popover
 * never mounts.
 */
export default function NotePeek({ note, at, by }: {
  note: string
  at: string | null
  by: string
}) {
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null)
  const anchor = useRef<HTMLButtonElement>(null)

  const show = useCallback(() => {
    const el = anchor.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.min(320, window.innerWidth - 24)
    // Prefer below; flip above when the row is near the bottom of the window.
    const above = r.bottom + 160 > window.innerHeight && r.top > 180
    setPos({
      top: above ? r.top - 8 : r.bottom + 8,
      left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)),
      above,
    })
  }, [])

  const hide = useCallback(() => setPos(null), [])

  // Scrolling the queue would leave a fixed bubble stranded beside the wrong
  // row, so any scroll or resize closes it.
  useEffect(() => {
    if (!pos) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('keydown', onKey)
    }
  }, [pos, hide])

  const byline = [by ? adminInitials(by) : '', at ? timeAgo(at) : ''].filter(Boolean).join(' · ')

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label="Admin note"
        title={note}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        // The mobile queue card is a <Link>; without this a tap on the badge
        // navigates into the case instead of showing the note.
        onClick={e => { e.preventDefault(); e.stopPropagation(); if (pos) hide(); else show() }}
        // Transparent button, visual chip inside: the console's mobile layer
        // forces every button to a 38px tap target, and the badge itself must
        // stay small enough to sit beside a 12.5px display ID.
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, padding: 0, border: 'none', background: 'transparent',
          verticalAlign: 'middle', cursor: 'pointer', lineHeight: 0,
        }}
      >
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 20, borderRadius: 5, color: C.txt2,
          background: C.marker, border: `1px solid ${C.limeDeep}`,
        }}>
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" fill="none"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2 3h8M2 6h8M2 9h5" />
          </svg>
        </span>
      </button>
      {pos && (
        <div
          role="tooltip"
          style={{
            position: 'fixed', top: pos.top, left: pos.left, zIndex: 60,
            transform: pos.above ? 'translateY(-100%)' : undefined,
            width: 'min(320px, calc(100vw - 24px))',
            background: C.surface, border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${C.limeDeep}`, borderRadius: 10,
            padding: '10px 12px', fontFamily: C.sans, textAlign: 'left',
            boxShadow: '0 16px 34px -12px rgba(20,20,19,0.4)',
            pointerEvents: 'none',
          }}
        >
          <div style={{
            display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5,
            fontFamily: C.mono, fontSize: 10, fontWeight: 600, letterSpacing: '0.09em',
            textTransform: 'uppercase', color: C.txt3,
          }}>
            <span>Admin note</span>
            {byline && <span style={{ marginLeft: 'auto', letterSpacing: 0, textTransform: 'none', fontFamily: C.sans, fontSize: 11 }}>{byline}</span>}
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: C.txt, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {note}
          </p>
        </div>
      )}
    </>
  )
}
