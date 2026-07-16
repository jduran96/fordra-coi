/**
 * Normalize a contact field (name/phone/email) from a stored note: trims and
 * treats placeholder junk like "n/a" or "-" as missing, so renderers never
 * show a verification tag on a value that does not exist (seen live: a note
 * with email "n/a" wearing a "Differs from online" tag).
 */
export function contactValue(s: string | undefined | null): string {
  const v = (s ?? '').trim()
  return /^(n\/?a|none|-+|—)$/i.test(v) ? '' : v
}
