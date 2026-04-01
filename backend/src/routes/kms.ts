import { Router } from 'express'
import { encryptWithKMS, decryptWithKMS, generateDataKey } from '../lib/kmsClient.js'

const router = Router()

/**
 * GET /kms/test
 *
 * KMS connectivity check — requires X-Backend-Secret header.
 * Verifies all three KMS operations: GenerateDataKey, Encrypt, Decrypt.
 */
router.get('/test', async (_req, res) => {
  try {
    // 1. Generate a DEK
    const { plaintext, ciphertext } = await generateDataKey()
    if (plaintext.length !== 32) throw new Error(`Unexpected DEK length: ${plaintext.length}`)
    plaintext.fill(0) // discard — we only need to verify the call succeeded

    // 2. Encrypt a small test payload
    const testPayload = Buffer.from('kms-test-payload')
    const encrypted = await encryptWithKMS(testPayload)
    if (!encrypted.length) throw new Error('Encrypt returned empty buffer')

    // 3. Decrypt it back and verify round-trip
    const decrypted = await decryptWithKMS(encrypted)
    if (!decrypted.equals(testPayload)) {
      throw new Error(`Round-trip mismatch: got "${decrypted.toString()}"`)
    }

    res.json({
      success: true,
      checks: {
        generateDataKey: 'ok',
        encrypt: 'ok',
        decrypt: 'ok',
        encryptedDekBytes: ciphertext.length,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(500).json({ success: false, error: message })
  }
})

export default router
