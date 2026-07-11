/**
 * Fetch a customer-supplied document by URL for /v1 submissions ("attach it,
 * or paste a link if it's big"): links bypass Vercel's ~4.5MB request-body
 * cap because the download is an outbound fetch. The bytes then go through
 * exactly the same validateUpload sniffing/size caps as an attached file.
 */

/** True when a form value should be treated as a document link, not text. */
export function isDocumentUrl(s: string): boolean {
  const t = s.trim()
  if (!/^https?:\/\//i.test(t)) return false
  try { new URL(t); return true } catch { return false }
}

/**
 * URL guard, same rules as the webhook endpoint guard in lib/webhooks.ts:
 * https only in production and never private/internal hosts — a link that
 * resolves inside our network would be an SSRF primitive. Local dev may use
 * a localhost source for testing.
 */
function allowedRemoteUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  const host = u.hostname.toLowerCase()
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  if (!process.env.VERCEL) {
    return u.protocol === 'https:' || (u.protocol === 'http:' && isLoopback)
  }
  if (u.protocol !== 'https:') return false
  if (isLoopback
    || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host)
    || host.endsWith('.internal') || host.endsWith('.local')) {
    return false
  }
  return true
}

export type RemoteDoc =
  | { ok: true; bytes: ArrayBuffer; contentType: string; name: string }
  | { ok: false; error: string }

export async function fetchRemoteDocument(url: string, maxBytes: number): Promise<RemoteDoc> {
  const maxMb = Math.floor(maxBytes / (1024 * 1024))
  if (!allowedRemoteUrl(url)) {
    return { ok: false, error: 'The link must be a public https URL.' }
  }
  let res: Response
  try {
    res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) })
  } catch {
    return { ok: false, error: 'The link could not be downloaded. Check that it is reachable and try again.' }
  }
  // Redirects are followed; the FINAL destination must pass the guard too.
  if (!allowedRemoteUrl(res.url || url)) {
    return { ok: false, error: 'The link must be a public https URL.' }
  }
  if (!res.ok) {
    return { ok: false, error: `The link responded with HTTP ${res.status}. Check that it is accessible (a presigned or public URL) and not expired.` }
  }
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > maxBytes) {
    return { ok: false, error: `The linked file is too large (${maxMb} MB max).` }
  }
  let bytes: ArrayBuffer
  try {
    bytes = await res.arrayBuffer()
  } catch {
    return { ok: false, error: 'The link could not be downloaded. Check that it is reachable and try again.' }
  }
  if (bytes.byteLength > maxBytes) {
    return { ok: false, error: `The linked file is too large (${maxMb} MB max).` }
  }

  // Best display name: the URL path's basename, without the query noise.
  let name = 'document'
  try {
    const base = new URL(res.url || url).pathname.split('/').filter(Boolean).pop()
    if (base) name = decodeURIComponent(base)
  } catch { /* keep fallback */ }

  return { ok: true, bytes, contentType: res.headers.get('content-type')?.split(';')[0].trim() || '', name }
}
