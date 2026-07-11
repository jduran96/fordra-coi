/**
 * Server-side validation for customer-supplied documents. The client `accept`
 * attribute and Content-Type header are attacker-controlled; sniff the actual
 * bytes and cap the size before anything is stored or sent to Claude.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB default per-file cap

/**
 * Per-slot caps (owner decision 2026-07-11): EVERY submitted document caps at
 * 10 MB — matching the storage bucket's own file_size_limit, so the bucket
 * and the app agree. "Any other relevant documents" ('rcs') additionally
 * share a 50 MB TOTAL budget (enforced by callers).
 */
export const UPLOAD_MAX_BYTES: Record<'coi' | 'rcs' | 'requirements', number> = {
  coi: 10 * 1024 * 1024,
  rcs: 10 * 1024 * 1024,
  requirements: 10 * 1024 * 1024,
}
export const OTHER_DOCS_TOTAL_BYTES = 50 * 1024 * 1024
export const OTHER_DOCS_MAX_COUNT = 5

export type UploadKind = 'pdf' | 'image' | 'docx' | 'text'

export interface UploadCheck {
  ok: boolean
  /** Sniffed MIME type when recognized; falls back to the declared type. */
  mimeType: string
  error?: string
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false
  return sig.every((b, i) => bytes[offset + i] === b)
}

function sniff(bytes: Uint8Array): { kind: UploadKind; mime: string } | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return { kind: 'pdf', mime: 'application/pdf' } // %PDF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg' }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { kind: 'image', mime: 'image/png' }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { kind: 'image', mime: 'image/webp' } // RIFF....WEBP
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // ZIP container; DOCX is the only zip type we accept.
    return { kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  }
  return null
}

/** Heuristic: printable text with no NUL bytes in the first KB. */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 1024)
  if (sample.length === 0) return false
  return !sample.includes(0)
}

/**
 * Validate an uploaded document's size and content type.
 * `allow` lists what this slot accepts (e.g. a COI: ['pdf', 'image']).
 */
export function validateUpload(
  buffer: ArrayBuffer,
  declaredMime: string,
  allow: UploadKind[],
  maxBytes: number = MAX_UPLOAD_BYTES,
): UploadCheck {
  return validateUploadHead(new Uint8Array(buffer), buffer.byteLength, declaredMime, allow, maxBytes)
}

/**
 * Same checks from just the leading bytes plus the true object size — for
 * documents already sitting in storage (direct-to-storage uploads), where
 * downloading the whole file only to sniff 4 magic bytes would be wasteful.
 * `head` must cover at least the first KB for the text heuristic.
 */
export function validateUploadHead(
  head: Uint8Array,
  sizeBytes: number,
  declaredMime: string,
  allow: UploadKind[],
  maxBytes: number = MAX_UPLOAD_BYTES,
): UploadCheck {
  const fallback = declaredMime || 'application/octet-stream'
  if (sizeBytes === 0) return { ok: false, mimeType: fallback, error: 'The file is empty.' }
  if (sizeBytes > maxBytes) {
    return { ok: false, mimeType: fallback, error: `The file is too large (${Math.floor(maxBytes / (1024 * 1024))} MB max).` }
  }

  const sniffed = sniff(head)
  if (sniffed && allow.includes(sniffed.kind)) return { ok: true, mimeType: sniffed.mime }
  if (!sniffed && allow.includes('text') && looksLikeText(head)) {
    return { ok: true, mimeType: 'text/plain' }
  }

  const names: Record<UploadKind, string> = { pdf: 'pdf', image: 'jpg, png', docx: 'docx', text: 'txt' }
  return {
    ok: false,
    mimeType: fallback,
    error: `Unsupported file type. Accepted: ${allow.map(k => names[k]).join(', ')}.`,
  }
}

/** Accepted kinds per document slot, shared by web, API, and Slack intake. */
export const UPLOAD_ALLOW: Record<'coi' | 'rcs' | 'requirements', UploadKind[]> = {
  coi: ['pdf', 'image'],
  rcs: ['pdf', 'image', 'docx', 'text'],
  requirements: ['pdf', 'image', 'docx', 'text'],
}
