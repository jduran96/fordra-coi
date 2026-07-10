/** Shared brand palette + fonts.
 *  Krida-inspired editorial system: warm cream paper + warm near-black ink +
 *  electric lime signature accent. Mirrors the marketing site tokens.css.
 *  Fonts: Newsreader (display) + Hanken Grotesk (body) + JetBrains Mono.
 */
export const C = {
  // ── Backgrounds ──
  paper:       '#faf9f5',   // cream-light, main background
  cream:       '#f2efea',   // subtle block background
  surface:     '#ffffff',
  surfaceHover:'#f2efea',

  // ── Ink / text ──
  ink:         '#141413',   // warm near-black
  inkSoft:     '#2a2926',
  txt:         '#141413',
  txt2:        '#57544e',
  txt3:        '#7e7e7e',
  txtMuted:    '#a6a4a0',

  // ── Borders ──
  border:      'rgba(20, 20, 19, 0.12)',
  borderStrong:'rgba(20, 20, 19, 0.28)',

  // ── Signature accent ──
  lime:        '#d4fd8e',   // electric lime, the pop
  limeDeep:    '#c2f06f',   // hover / pressed lime
  marker:      '#d8fca6',   // highlighter underline tint

  // ── Solid-fill accent (was orange "earthy") → now ink ──
  earthy:      '#141413',
  earthyDim:   'rgba(20, 20, 19, 0.06)',

  // ── Status (semantic, stay distinct) ──
  ok:          'oklch(46% 0.14 155)',
  success:     'oklch(46% 0.14 155)',
  warn:        'oklch(70% 0.15 75)',
  error:       'oklch(57.7% 0.245 27.325)',
  neutral:     '#a6a4a0',

  // ── On-dark variants ──
  onDark:      '#faf9f5',
  onDarkMuted: '#a6a4a0',

  // ── Fonts ──
  serif:       "'Newsreader', Georgia, 'Times New Roman', serif",
  sans:        "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono:        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const

/** Status pill colors for ui_status / verification status. */
export function statusColor(status: string): string {
  switch (status) {
    case 'completed': return C.ok
    case 'error':     return C.error
    case 'rejected':  return C.error
    case 'in_review': return C.warn
    default:          return C.neutral // pending / processing / analyzing
  }
}
