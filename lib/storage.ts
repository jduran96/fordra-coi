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

/** Download a stored document's bytes + content type (service role — server only). */
export async function downloadDocument(path: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const svc = createServiceClient()
  const { data, error } = await svc.storage.from(DOCUMENTS_BUCKET).download(path)
  if (error || !data) throw new Error(`download failed: ${error?.message ?? 'unknown'}`)
  return { bytes: await data.arrayBuffer(), contentType: data.type || 'application/octet-stream' }
}
