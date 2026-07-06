import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { uploadDocument } from '@/lib/storage'

export type DocumentKind = 'coi' | 'rcs' | 'requirements'

export interface VerificationFile {
  bytes: ArrayBuffer | Uint8Array
  name: string
  mimeType: string
  kind: DocumentKind
  /** Already in the documents bucket at this path — record it, skip the upload. */
  existingStoragePath?: string
}

export interface CreateVerificationInput {
  orgId: string
  carrierName: string
  verifierCompany?: string
  source: 'web' | 'api' | 'slack'
  /** Stored as-is; web uses { text }, API/Slack use [{ type: 'text', value }]. */
  requirements: unknown
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
    ...(input.autoCall !== undefined ? { auto_call: input.autoCall } : {}),
  }).select(input.select ?? '*').single<Record<string, unknown>>()
  if (error || !v) throw new Error(error?.message || 'Could not create verification.')

  const docRefs: DocRef[] = []
  for (const f of input.files) {
    const docId = randomUUID()
    const path = f.existingStoragePath ?? `${input.orgId}/${v.id}/${f.kind}-${f.name}`
    if (!f.existingStoragePath) await uploadDocument(path, f.bytes, f.mimeType)
    const { error: derr } = await db.from('documents').insert({
      id: docId,
      org_id: input.orgId,
      verification_id: v.id,
      kind: f.kind,
      storage_path: path,
      file_name: f.name,
      mime_type: f.mimeType,
      size_bytes: f.bytes.byteLength,
      extraction_status: 'processing',
      ...(input.createdBy ? { uploaded_by: input.createdBy } : {}),
    })
    if (derr) throw new Error(derr.message)
    docRefs.push({ id: docId, kind: f.kind, file_name: f.name })
  }

  return { verification: v, docRefs }
}
