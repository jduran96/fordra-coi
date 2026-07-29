import 'server-only'
import type { createServiceClient } from '@/lib/supabase/server'
import { verifyLoggedContact } from '@/lib/claude'
import { contactValue, noteCheckFromRegistry } from '@/lib/contact-notes'
import type { ContactCheckEntry, ContactNote, NoteContactCheck } from '@/lib/types'

type ServiceClient = ReturnType<typeof createServiceClient>

export interface ContactCheckInput {
  producer: string
  insurer: string
  phone: string
  email: string
}

/**
 * The contact-check core shared by the admin's "Run online check" button
 * (app/admin/(console)/actions.ts runOnlineContactCheck, which adds
 * requireAdmin + closed-case gating + form parsing) and the one-time auto run
 * (lib/auto-checks.ts). Web-verifies the phone/email against the producer's
 * public listings, APPENDS to the verification-level check history via the
 * atomic admin_append_contact_check RPC, then re-tags the contact logs.
 * Each run costs real money (Haiku + up to 4 searches + 2 page fetches,
 * ~$0.05-0.20) — callers gate how often it fires.
 */
export async function performContactCheck(
  supabase: ServiceClient,
  verificationId: string,
  { producer, insurer, phone, email }: ContactCheckInput,
): Promise<{ error?: string } | void> {
  const check = await verifyLoggedContact({ producer, insurer, phone, email })
  if (!check) return { error: 'The web check came back empty. Please retry.' }
  const entry: ContactCheckEntry = {
    ...check,
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
  }
  const { error: werr } = await supabase.rpc('admin_append_contact_check', {
    vid: verificationId,
    entry,
  })
  if (werr) {
    console.error('performContactCheck: write failed', werr)
    return { error: 'Could not save the check. Please retry.' }
  }
  await retroTagNotes(supabase, verificationId)
}

/**
 * Re-derive every contact log's check snapshot from the current check
 * history (after a run or an edit), so logs written BEFORE a check still get
 * their tags. Rules:
 *  - a note whose own check was hand-edited (contact_check.edited_at) is
 *    never touched: edited_at marks human-curated customer copy;
 *  - a field the history does not match keeps the note's existing status
 *    (legacy per-log check results survive);
 *  - no match at all leaves the note alone (never destroys old data).
 * Writes go per-note through the atomic admin_set_note_check RPC — never
 * read-modify-write the whole call_notes array. Failures log and continue:
 * each note is independently correct.
 */
export async function retroTagNotes(supabase: ServiceClient, verificationId: string): Promise<void> {
  const { data: v, error } = await supabase.from('verifications')
    .select('call_notes, contact_checks')
    .eq('id', verificationId)
    .maybeSingle()
  if (error || !v) {
    console.error('retroTagNotes: read failed', error)
    return
  }
  const notes = (Array.isArray(v.call_notes) ? v.call_notes : []) as ContactNote[]
  const entries = (Array.isArray(v.contact_checks) ? v.contact_checks : []) as ContactCheckEntry[]
  for (const note of notes) {
    if (note.contact_check?.edited_at) continue
    const phone = contactValue(note.contact?.phone)
    const email = contactValue(note.contact?.email)
    if (!phone && !email) continue
    const candidate = noteCheckFromRegistry(entries, phone, email)
    if (!candidate) continue
    const existing = note.contact_check
    const merged: NoteContactCheck = {
      ...candidate,
      // Carry a status the history did not cover from the note's old check.
      ...(!candidate.phone_status && existing?.phone_status ? { phone_status: existing.phone_status } : {}),
      ...(!candidate.email_status && existing?.email_status ? { email_status: existing.email_status } : {}),
    }
    if (existing && JSON.stringify(existing) === JSON.stringify(merged)) continue
    const { error: werr } = await supabase.rpc('admin_set_note_check', {
      vid: verificationId,
      note_at: note.at,
      check_data: merged,
    })
    if (werr) console.error('retroTagNotes: write failed for note', note.at, werr)
  }
}
