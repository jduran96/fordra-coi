'use client'

import { C } from '@/lib/theme'
import { formatSec, formatTranscript } from '@/lib/call-transcript'
import type { TranscriptEntry } from '@/lib/ai-call-shared'

/**
 * High-fidelity transcript rendering from Retell's structured entries:
 * per-turn timestamps, keypad presses, and long pauses made visible. Falls
 * back to the flat pre-wrap string for rows without structured detail (old
 * calls Retell has purged, or live partials before the first sync lands).
 */
export default function TranscriptView({ detail, flat, emptyText = '' }: {
  detail: TranscriptEntry[] | null
  flat: string
  emptyText?: string
}) {
  const turns = detail?.length ? formatTranscript(detail) : null
  if (!turns) {
    return <>{flat || emptyText}</>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {turns.map((t, i) => {
        if (t.kind === 'pause') {
          return (
            <span key={i} style={{ fontSize: 12, color: C.txt3, fontStyle: 'italic' }}>
              ({formatSec(t.seconds)} pause)
            </span>
          )
        }
        if (t.kind === 'keypress') {
          return (
            <span key={i} style={{ fontSize: 12, color: C.txt3, fontFamily: C.mono }}>
              [keypad] {t.digit ? `pressed ${t.digit}` : 'key press attempted but failed'}
            </span>
          )
        }
        return (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            {t.atSec !== undefined && (
              <span style={{ fontSize: 11, color: C.txt3, fontFamily: C.mono, flexShrink: 0, minWidth: 34 }}>
                {formatSec(t.atSec)}
              </span>
            )}
            <span style={{ overflowWrap: 'anywhere' }}>
              <strong style={{ color: t.speaker === 'agent' ? C.txt : C.txt2 }}>
                {t.speaker === 'agent' ? 'Agent' : 'Callee'}:
              </strong>{' '}
              {t.text}
            </span>
          </div>
        )
      })}
    </div>
  )
}
