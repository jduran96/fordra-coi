import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { uploadDocument, removeDocuments } from '@/lib/storage'

export type DocumentKind = 'coi' | 'rcs' | 'requirements'

export interface VerificationFile {
  /** Required unless existingStoragePath is set (direct-to-storage uploads). */
  bytes?: ArrayBuffer | Uint8Array
  name: string
  mimeType: string
  kind: DocumentKind
  /** Already in the documents bucket at this path — record it, skip the upload. */
  existingStoragePath?: string
  /** True object size when bytes are not in memory (existingStoragePath set). */
  sizeBytes?: number
}

export interface CreateVerificationInput {
  orgId: string
  carrierName: string
  verifierCompany?: string
  source: 'web' | 'api' | 'slack'
  /** Stored as-is; web uses { text }, API/Slack use [{ type: 'text', value }]. */
  requirements: unknown
  /** Provenance: the requirement_templates row the standards came from. */
  templateId?: string
  autoCall?: boolean
  createdBy?: string
  files: VerificationFile[]
  /**
   * Columns to return from the insert. Default '*' (fine for the service
   * client). The web path passes the RLS session client, where column-level
   * grants on `verifications` make select('*') fail with permission denied —
   * pass a granted subset (e.g. 'id') there.
   */
  select?: string
}

export interface DocRef { id: string; kind: string; file_name: string; [key: string]: unknown }

/**
 * Shared verification creation: insert the row, upload each document, insert
 * document rows. Used by the web action, the /v1 API, and the Slack intake.
 * Pass a service client (API/Slack) or the RLS-scoped session client (web).
 */
export async function createVerification(
  db: SupabaseClient,
  input: CreateVerificationInput,
): Promise<{ verification: Record<string, unknown>; docRefs: DocRef[] }> {
  const { data: v, error } = await db.from('verifications').insert({
    org_id: input.orgId,
    carrier_name: input.carrierName,
    ...(input.verifierCompany ? { verifier_company: input.verifierCompany } : {}),
    ...(input.createdBy ? { created_by: input.createdBy } : {}),
    source: input.source,
    status: 'pending',
    requirements: input.requirements ?? null,
    ...(input.templateId ? { template_id: input.templateId } : {}),
    ...(input.autoCall !== undefined ? { auto_call: input.autoCall } : {}),
  }).select(input.select ?? '*').single<Record<string, unknown>>()
  if (error || !v) throw new Error(error?.message || 'Could not create verification.')

  const docRefs: DocRef[] = []
  // Track what this call created so a mid-loop failure can be compensated:
  // without cleanup, the customer is told the submission failed while an
  // eternally-pending verification row (and orphaned storage) lives on.
  const uploadedPaths: string[] = []
  const usedPaths = new Set<string>()
  try {
    for (const f of input.files) {
      const docId = randomUUID()
      // Raw filenames can contain characters Supabase Storage rejects as
      // object keys (#, ?, unicode). Sanitize the KEY only; file_name below
      // keeps the original for display.
      const safeName = f.name.replace(/[^\w.\- ]+/g, '_')
      let path = f.existingStoragePath ?? `${input.orgId}/${v.id}/${f.kind}-${safeName}`
      // Multiple docs of one kind can share a filename; keys must not collide.
      for (let n = 2; usedPaths.has(path); n++) {
        path = `${input.orgId}/${v.id}/${f.kind}-${n}-${safeName}`
      }
      usedPaths.add(path)
      if (!f.existingStoragePath) {
        if (!f.bytes) throw new Error(`file "${f.name}" has neither bytes nor a storage path`)
        await uploadDocument(path, f.bytes, f.mimeType)
        uploadedPaths.push(path)
      }
      const { error: derr } = await db.from('documents').insert({
        id: docId,
        org_id: input.orgId,
        verification_id: v.id,
        kind: f.kind,
        storage_path: path,
        file_name: f.name,
        mime_type: f.mimeType,
        size_bytes: f.sizeBytes ?? f.bytes?.byteLength ?? 0,
        extraction_status: 'processing',
        ...(input.createdBy ? { uploaded_by: input.createdBy } : {}),
      })
      if (derr) throw new Error(derr.message)
      docRefs.push({ id: docId, kind: f.kind, file_name: f.name })
    }
  } catch (e) {
    // Best-effort compensation, then rethrow the original failure. Retrying
    // the whole submission is then safe: nothing half-created remains.
    await db.from('documents').delete().eq('verification_id', v.id as string).then(() => {}, () => {})
    await removeDocuments(uploadedPaths)
    await db.from('verifications').delete().eq('id', v.id as string).then(() => {}, () => {})
    throw e
  }

  return { verification: v, docRefs }
}
