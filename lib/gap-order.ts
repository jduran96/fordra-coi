import { parseStandardLine } from './templates'

/**
 * Verdict rows (gap analysis / final report items) display in the order the
 * standards were SUBMITTED, on the admin review and the customer report alike
 * (owner decision 2026-07-17) — never regrouped by status.
 *
 * Matching is lenient (case/whitespace-insensitive label, then notes wording)
 * because older rows carry model-invented labels; anything unmatched — legacy
 * labels, admin-added custom rows, doc-derived requirements ordered from the
 * submitted text — keeps its existing relative order after the matched rows.
 */
export interface OrderKey {
  label: string
  notes: string
}

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase()

/** Order keys from parsed requirements (requirements_normalized keeps submitted order). */
export function orderFromRequirements(reqs: { coverage_type?: string; notes?: string | null }[]): OrderKey[] {
  return reqs.map(r => ({ label: norm(r.coverage_type), notes: norm(r.notes) }))
}

/** Order keys from the raw submitted standards text, one standard per line. */
export function orderFromText(text: string): OrderKey[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const r = parseStandardLine(l)
      return { label: norm(r.title), notes: norm(r.notes) }
    })
}

export function orderBySubmitted<T extends { requirement?: { coverage_type?: string; notes?: string | null } }>(
  rows: T[],
  order: OrderKey[],
): T[] {
  if (!order.length) return rows
  const pos = (row: T) => {
    const label = norm(row.requirement?.coverage_type)
    const notes = norm(row.requirement?.notes)
    let i = label ? order.findIndex(o => o.label === label) : -1
    if (i === -1 && notes) i = order.findIndex(o => o.notes && o.notes === notes)
    return i === -1 ? order.length : i
  }
  return rows
    .map((row, i) => ({ row, p: pos(row), i }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map(x => x.row)
}
