import { createServiceClient } from '@/lib/supabase/server'

export const DOCUMENTS_BUCKET = 'documents'

/** Upload bytes to the private documents bucket (service role — server only). */
export async function uploadDocument(path: string, bytes: ArrayBuffer | Uint8Array, contentType: string) {
  const svc = createServiceClient()
  const { error } = await svc.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, bytes, { contentType, upsert: false })
  if (error) throw new Error(`storage upload failed: ${error.message}`)
  return path
}

/** Short-lived signed URL to view a stored original (service role — server only). */
export async function signedUrl(path: string, expiresIn = 3600): Promise<string> {
  const svc = createServiceClient()
  const { data, error } = await svc.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(path, expiresIn)
  if (error || !data) throw new Error(`signed url failed: ${error?.message ?? 'unknown'}`)
  return data.signedUrl
}

/** Best-effort removal, for compensating partial failures. Never throws. */
export async function removeDocuments(paths: string[]): Promise<void> {
  if (!paths.length) return
  try {
    const svc = createServiceClient()
    await svc.storage.from(DOCUMENTS_BUCKET).remove(paths)
  } catch (e) {
    console.error('storage cleanup failed', e)
  }
}

/**
 * Mint a signed upload URL so the BROWSER can PUT a file straight into the
 * private bucket (bypassing Vercel's ~4.5MB request-body cap). The token is
 * single-path and short-lived; the server validates the object after upload
 * (see submitVerification) before any verification references it.
 */
export async function createSignedUpload(path: string): Promise<{ path: string; token: string }> {
  const svc = createServiceClient()
  const { data, error } = await svc.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUploadUrl(path)
  if (error || !data) throw new Error(`signed upload failed: ${error?.message ?? 'unknown'}`)
  return { path: data.path, token: data.token }
}

/**
 * First KB + true size of a stored object via a Range request — enough to
 * magic-byte sniff and size-check a direct upload without downloading it.
 */
export async function statStoredObject(path: string): Promise<{ head: Uint8Array; size: number } | null> {
  // NOTE: must be the /object/authenticated/ endpoint — the bare /object/
  // path 400s for service-role GETs (verified 2026-07-11).
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/authenticated/${DOCUMENTS_BUCKET}/${path}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Range: 'bytes=0-1023',
      },
    },
  )
  if (!res.ok && res.status !== 206) return null
  const head = new Uint8Array(await res.arrayBuffer())
  // "bytes 0-1023/26214400" → total; a small file may come back as plain 200.
  const range = res.headers.get('content-range')
  const total = range?.match(/\/(\d+)$/)?.[1]
  const size = total ? Number(total) : Number(res.headers.get('content-length') ?? head.byteLength)
  return { head, size }
}

/** Download a stored document's bytes + content type (service role — server only). */
export async function downloadDocument(path: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const svc = createServiceClient()
  const { data, error } = await svc.storage.from(DOCUMENTS_BUCKET).download(path)
  if (error || !data) throw new Error(`download failed: ${error?.message ?? 'unknown'}`)
  return { bytes: await data.arrayBuffer(), contentType: data.type || 'application/octet-stream' }
}
