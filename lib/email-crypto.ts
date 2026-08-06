import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * At-rest encryption for mailbox OAuth tokens (email_accounts, migration
 * 0040). The table is already service-role only; this layer means a leaked
 * database dump or backup still does not yield live mailbox credentials.
 * AES-256-GCM with a key held only in the EMAIL_TOKEN_KEY env var (32 bytes,
 * base64). Blobs are stored as `iv.tag.ciphertext`, each part base64.
 *
 * Generate a key with: openssl rand -base64 32
 */

function key(): Buffer {
  const raw = process.env.EMAIL_TOKEN_KEY
  if (!raw) throw new Error('EMAIL_TOKEN_KEY is not set; refusing to handle mailbox tokens without encryption')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) throw new Error('EMAIL_TOKEN_KEY must be 32 bytes of base64 (openssl rand -base64 32)')
  return buf
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.')
}

export function decryptSecret(blob: string): string {
  const [iv, tag, data] = blob.split('.')
  if (!iv || !tag || !data) throw new Error('Malformed encrypted secret')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}
