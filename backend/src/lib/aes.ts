import { createDecipheriv, scryptSync } from 'crypto'

/**
 * AES-256-GCM decryption compatible with /web/lib/crypto.ts.
 *
 * Used to read KEP and token values that were encrypted by the /web layer
 * before KMS wrapping is applied. The /web encryption is NOT replaced —
 * this just provides the backend the ability to read existing DB values.
 *
 * Format stored in DB: "<ivHex>:<tagHex>:<ciphertextHex>"
 */
export function aesDecrypt(payload: string): string {
  const secret = process.env.TOKEN_ENCRYPTION_KEY
  if (!secret) throw new Error('TOKEN_ENCRYPTION_KEY is not set')

  const key = scryptSync(secret, 'dps-monitor-salt', 32)
  const [ivHex, tagHex, encryptedHex] = payload.split(':')

  if (!ivHex || !tagHex || !encryptedHex) {
    throw new Error('aesDecrypt: malformed payload — expected iv:tag:ciphertext')
  }

  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
