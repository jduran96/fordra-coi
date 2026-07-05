import { spawn } from 'node:child_process'

/**
 * A fetch() implementation that shells out to the system `curl`.
 *
 * Why: on some local machines Node's bundled TLS stack corrupts large HTTPS
 * uploads (intermittent `ERR_SSL_..._BAD_RECORD_MAC`), while the system curl —
 * using the OS TLS stack — is rock solid for the same requests. The Anthropic
 * SDK accepts a custom `fetch`, so we route its calls through curl in local dev.
 * Production (Vercel) keeps native fetch, which works fine there.
 *
 * Scope: handles the non-streaming JSON requests this app makes (string body,
 * buffered response). Not a general-purpose streaming fetch.
 */
export function curlFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = (init?.method ?? 'GET').toUpperCase()

  const headers: Record<string, string> = {}
  const h = init?.headers
  if (h instanceof Headers) h.forEach((v, k) => { headers[k] = v })
  else if (Array.isArray(h)) for (const [k, v] of h) headers[k] = v as string
  else if (h) Object.assign(headers, h)

  const body = init?.body as string | Uint8Array | undefined

  const args = ['-sS', '-i', '-X', method, '--max-time', '600']
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`)
  if (body != null) args.push('--data-binary', '@-')
  args.push(url)

  return new Promise((resolve, reject) => {
    const child = spawn('curl', args)
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', d => out.push(d))
    child.stderr.on('data', d => err.push(d))
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`curl exited ${code}: ${Buffer.concat(err).toString().slice(0, 300)}`))
      }
      const raw = Buffer.concat(out)
      // Find the blank line separating the last header block from the body.
      let sep = raw.indexOf('\r\n\r\n')
      let sepLen = 4
      if (sep === -1) { sep = raw.indexOf('\n\n'); sepLen = 2 }
      const headPart = (sep === -1 ? raw : raw.subarray(0, sep)).toString('utf8')
      const bodyBuf = sep === -1 ? Buffer.alloc(0) : raw.subarray(sep + sepLen)

      const lines = headPart.split(/\r?\n/)
      const statusLine = lines[0] || 'HTTP/1.1 200'
      const status = parseInt(statusLine.split(/\s+/)[1], 10) || 200
      const respHeaders = new Headers()
      for (const line of lines.slice(1)) {
        const idx = line.indexOf(':')
        if (idx > 0) {
          try { respHeaders.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim()) } catch { /* skip invalid */ }
        }
      }
      resolve(new Response(bodyBuf, { status, headers: respHeaders }))
    })

    if (body != null) {
      child.stdin.write(typeof body === 'string' ? body : Buffer.from(body))
      child.stdin.end()
    } else {
      child.stdin.end()
    }
  })
}
