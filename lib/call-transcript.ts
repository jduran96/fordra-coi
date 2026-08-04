import type { TranscriptEntry } from '@/lib/ai-call-shared'

/**
 * Turn Retell's transcript_with_tool_calls into display turns. Pure and
 * client-safe (no retell-sdk, no server-only imports) — used by the admin
 * TranscriptView client component, the status route, and publish-time note
 * formatting. Timestamps are relative audio seconds from per-word timings;
 * live partial utterances can arrive without `words`, so every timestamp is
 * optional and gap math skips turns that lack one.
 */

export type TranscriptTurn =
  | { kind: 'speech'; speaker: 'agent' | 'callee'; atSec?: number; text: string }
  | { kind: 'keypress'; digit: string }
  | { kind: 'pause'; seconds: number }

export function formatSec(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Retell lists entries in creation order, which for overlapping speech can
 * put a later-starting utterance first (an agent line split around a menu
 * replay shows [0:12] before [0:11]). Stable-sort by each entry's first-word
 * start; entries without timings (keypresses, live partials) inherit the
 * previous entry's time so they keep their relative position.
 */
function chronological(entries: TranscriptEntry[]): TranscriptEntry[] {
  let carry = 0
  return entries
    .map((e, i) => {
      const start = (e.role === 'agent' || e.role === 'user' || e.role === 'transfer_target')
        ? e.words?.[0]?.start
        : undefined
      if (start !== undefined) carry = start
      return { e, i, t: carry }
    })
    .sort((a, b) => (a.t - b.t) || (a.i - b.i))
    .map(k => k.e)
}

export function formatTranscript(entries: TranscriptEntry[], pauseThresholdSec = 15): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  let prevEndSec: number | undefined
  for (const e of chronological(entries)) {
    if (e.role === 'agent' || e.role === 'user' || e.role === 'transfer_target') {
      const text = (e.content ?? '').trim()
      if (!text) continue
      const words = e.words ?? []
      const atSec = words[0]?.start
      const endSec = words[words.length - 1]?.end
      if (atSec !== undefined && prevEndSec !== undefined && atSec - prevEndSec > pauseThresholdSec) {
        turns.push({ kind: 'pause', seconds: Math.round(atSec - prevEndSec) })
      }
      turns.push({ kind: 'speech', speaker: e.role === 'agent' ? 'agent' : 'callee', atSec, text })
      if (endSec !== undefined) prevEndSec = endSec
    } else if (e.role === 'tool_call_invocation' && e.name === 'press_digit') {
      let digit = ''
      try {
        digit = String((JSON.parse(e.arguments) as { digit_to_press?: unknown }).digit_to_press ?? '')
      } catch { /* malformed arguments: show the press without a digit */ }
      turns.push({ kind: 'keypress', digit })
    } else if (e.role === 'dtmf') {
      turns.push({ kind: 'keypress', digit: e.digit })
    }
    // tool_call_result, node_transition, sms, other tool invocations: display noise.
  }
  return turns
}

/**
 * Plain-text rendering for surfaces that store or print a string (the
 * published contact-log note the customer page shows). Pre-wrap friendly and
 * customer-readable: no bracketed jargon in the non-speech markers.
 */
export function formatTranscriptText(entries: TranscriptEntry[]): string {
  return formatTranscript(entries).map(t => {
    if (t.kind === 'pause') {
      return t.seconds < 90
        ? `(${t.seconds} second pause)`
        : `(${Math.round(t.seconds / 60)} minute pause)`
    }
    if (t.kind === 'keypress') {
      return t.digit ? `(pressed ${t.digit} on the phone menu)` : '(key press attempted but failed)'
    }
    const stamp = t.atSec !== undefined ? `[${formatSec(t.atSec)}] ` : ''
    return `${stamp}${t.speaker === 'agent' ? 'Agent' : 'Insurer'}: ${t.text}`
  }).join('\n')
}

/**
 * Trim each utterance's word timings to first + last — all the formatter
 * reads — so the 5s live-poll payload stays small.
 */
export function compactTranscriptEntries(entries: TranscriptEntry[]): TranscriptEntry[] {
  return entries.map(e => {
    if ((e.role === 'agent' || e.role === 'user' || e.role === 'transfer_target') && e.words && e.words.length > 2) {
      return { ...e, words: [e.words[0], e.words[e.words.length - 1]] }
    }
    return e
  })
}
