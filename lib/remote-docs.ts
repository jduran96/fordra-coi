import { lookup } from 'dns/promises'
import net from 'net'
import { Agent, fetch as undiciFetch } from 'undici'

/**
 * Fetch a customer-supplied document by URL for /v1 submissions ("attach it,
 * or paste a link if it's big"): links bypass Vercel's ~4.5MB request-body
 * cap because the download is an outbound fetch. The bytes then go through
 * exactly the same validateUpload sniffing/size caps as an attached file.
 */

/**
 * True when a form value should be treated as a document link, not text.
 * Must contain NO whitespace: a bare document URL never does, but a free-text
 * standards sentence that merely starts with "https://..." does — treating
 * that as a link would fetch it and hard-fail an otherwise valid submission.
 */
export function isDocumentUrl(s: string): boolean {
  const t = s.trim()
  if (!/^https?:\/\//i.test(t) || /\s/.test(t)) return false
  try { new URL(t); return true } catch { return false }
}

/** IP (v4 or v6) inside a private, loopback, link-local, or otherwise
 *  non-public range — the set an SSRF payload would aim at. */
function isPrivateIp(ip: string): boolean {
  const v = net.isIP(ip)
  if (v === 4) return isPrivateV4(ip)
  if (v === 6) {
    const ip6 = ip.toLowerCase()
    if (ip6 === '::1' || ip6 === '::') return true
    if (ip6.startsWith('fe80') || ip6.startsWith('fc') || ip6.startsWith('fd')) return true
    // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4, in BOTH the
    // dotted-quad form AND the hex form (::ffff:a9fe:a9fe), and block any other
    // ::ffff: mapping we cannot parse rather than let it through.
    if (ip6.includes('::ffff:')) {
      const dotted = ip6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
      if (dotted) return isPrivateV4(dotted[1])
      const hex = ip6.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
      if (hex) {
        const n = ((parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16)) >>> 0
        return isPrivateV4([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'))
      }
      return true
    }
    return false
  }
  return false
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  return (
    p[0] === 10 ||
    p[0] === 127 ||
    p[0] === 0 ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 169 && p[1] === 254) || // link-local incl. cloud metadata 169.254.169.254
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) // carrier-grade NAT
  )
}

type Guard =
  | { ok: false }
  | { ok: true; url: URL; pin: { ip: string; family: 4 | 6 } | null }

/**
 * Validate a URL and (in production) resolve it to a public IP that the fetch
 * will be PINNED to. Checking the hostname string alone let any public DNS
 * name with an internal A record through; resolving without pinning left a
 * DNS-rebinding race (the guard's lookup and fetch's lookup could differ).
 * We resolve once, reject if ANY answer is private, and hand the caller the
 * exact IP to connect to — the URL keeps the hostname so TLS SNI/cert
 * validation is unchanged.
 */
async function guardUrl(raw: string): Promise<Guard> {
  let url: URL
  try { url = new URL(raw) } catch { return { ok: false } }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isLoopbackName = host === 'localhost'

  if (!process.env.VERCEL) {
    // Local dev: allow https anywhere and http only to loopback, no pinning
    // (there is no internal network to protect on a dev machine).
    const ok = url.protocol === 'https:'
      || (url.protocol === 'http:' && (isLoopbackName || host === '127.0.0.1' || host === '::1'))
    return ok ? { ok: true, url, pin: null } : { ok: false }
  }

  if (url.protocol !== 'https:') return { ok: false }
  if (isLoopbackName || host.endsWith('.internal') || host.endsWith('.local')) return { ok: false }

  const ipLiteral = net.isIP(host)
  const answers: { address: string; family: number }[] = ipLiteral
    ? [{ address: host, family: ipLiteral }]
    : await lookup(host, { all: true }).catch(() => [])
  if (answers.length === 0) return { ok: false }
  if (answers.some(a => isPrivateIp(a.address))) return { ok: false }

  const chosen = answers[0]
  return { ok: true, url, pin: { ip: chosen.address, family: chosen.family === 6 ? 6 : 4 } }
}

/** An undici dispatcher that forces every connection for this request to the
 *  pre-validated IP, so fetch cannot re-resolve to a different (internal) IP. */
function pinnedAgent(ip: string, family: 4 | 6): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, _opts, cb) => cb(null, [{ address: ip, family }]),
    },
  })
}

export type RemoteDoc =
  | { ok: true; bytes: ArrayBuffer; contentType: string; name: string }
  | { ok: false; error: string }

/** Read the body with a hard byte ceiling, aborting mid-stream — a response
 *  with no Content-Length (chunked) can't buffer gigabytes into memory. */
async function readCapped(res: { body: ReadableStream<Uint8Array> | null; arrayBuffer: () => Promise<ArrayBuffer> }, maxBytes: number): Promise<ArrayBuffer | null> {
  const reader = res.body?.getReader()
  if (!reader) {
    const buf = await res.arrayBuffer()
    return buf.byteLength > maxBytes ? null : buf
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { await reader.cancel().catch(() => {}); return null }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.byteLength }
  return out.buffer
}

export async function fetchRemoteDocument(url: string, maxBytes: number): Promise<RemoteDoc> {
  const maxMb = Math.floor(maxBytes / (1024 * 1024))
  const tooLarge = { ok: false as const, error: `The linked file is too large (${maxMb} MB max).` }
  const unreachable = { ok: false as const, error: 'The link could not be downloaded. Check that it is reachable and try again.' }
  const notPublic = { ok: false as const, error: 'The link must be a public https URL.' }

  // Follow redirects manually so EACH hop is guarded and IP-pinned BEFORE the
  // request is issued — redirect: 'follow' would hit an internal redirect
  // target before we could inspect it.
  let current = url
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let res: any = null
  for (let hop = 0; hop < 5; hop++) {
    const guard = await guardUrl(current)
    if (!guard.ok) return notPublic
    const dispatcher = guard.pin ? pinnedAgent(guard.pin.ip, guard.pin.family) : undefined
    try {
      res = await undiciFetch(current, { redirect: 'manual', signal: AbortSignal.timeout(20_000), ...(dispatcher ? { dispatcher } : {}) })
    } catch {
      return unreachable
    } finally {
      if (dispatcher) dispatcher.close().catch(() => {})
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString()
      continue
    }
    break
  }
  if (!res) return unreachable
  if (res.status >= 300 && res.status < 400) return { ok: false, error: 'The link redirected too many times.' }
  if (!res.ok) {
    return { ok: false, error: `The link responded with HTTP ${res.status}. Check that it is accessible (a presigned or public URL) and not expired.` }
  }

  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > maxBytes) return tooLarge

  let bytes: ArrayBuffer | null
  try {
    bytes = await readCapped(res, maxBytes)
  } catch {
    return unreachable
  }
  if (bytes === null) return tooLarge

  // Best display name: the URL path's basename, without the query noise.
  let name = 'document'
  try {
    const base = new URL(current).pathname.split('/').filter(Boolean).pop()
    if (base) name = decodeURIComponent(base)
  } catch { /* keep fallback */ }

  return { ok: true, bytes, contentType: res.headers.get('content-type')?.split(';')[0].trim() || '', name }
}
