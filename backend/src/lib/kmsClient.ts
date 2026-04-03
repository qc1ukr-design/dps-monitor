import {
  KMSClient,
  EncryptCommand,
  DecryptCommand,
  GenerateDataKeyCommand,
} from '@aws-sdk/client-kms'

// KMSClient singleton — created once on first use and reused for all subsequent calls.
//
// Credential rotation note (P4): AWS credentials (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
// are read from process.env only at first initialization. If credentials are rotated while
// the process is running (e.g. via Railway env-var update), the cached client continues to
// use the old credentials until the process restarts.
//
// On Railway, updating env vars triggers an automatic redeployment — so rotation is safe
// in the current setup. If dynamic credential rotation (e.g. AWS IAM Roles Anywhere, or
// Secrets Manager rotation without redeployment) is ever introduced, this singleton must
// be replaced with a credential-aware factory that invalidates the cache on rotation.
let _client: KMSClient | null = null

/**
 * Returns the shared KMSClient singleton.
 * Exported so kms.ts can reuse the same instance instead of creating its own.
 * All callers in this process share one authenticated connection to AWS KMS.
 */
export function getClient(): KMSClient {
  if (_client) return _client

  const region = process.env.AWS_REGION
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY

  if (!region) throw new Error('AWS_REGION is not set')
  if (!accessKeyId) throw new Error('AWS_ACCESS_KEY_ID is not set')
  if (!secretAccessKey) throw new Error('AWS_SECRET_ACCESS_KEY is not set')

  _client = new KMSClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  })

  return _client
}

function getKeyId(): string {
  const keyId = process.env.AWS_KMS_KEY_ID
  if (!keyId) throw new Error('AWS_KMS_KEY_ID is not set')
  return keyId
}

/**
 * Encrypt raw bytes directly with the KMS master key (no envelope).
 * KMS limit: plaintext must be ≤ 4096 bytes — use for small payloads only.
 * For large payloads use envelope encryption via kms.ts / kmsEncrypt().
 */
export async function encryptWithKMS(plaintext: Buffer): Promise<Buffer> {
  const { CiphertextBlob } = await getClient().send(
    new EncryptCommand({ KeyId: getKeyId(), Plaintext: plaintext })
  )

  if (!CiphertextBlob) throw new Error('KMS Encrypt returned empty CiphertextBlob')

  return Buffer.from(CiphertextBlob)
}

/**
 * Decrypt bytes that were encrypted with encryptWithKMS().
 *
 * Memory safety note: `Buffer.from(Plaintext)` creates a copy of the DEK from the AWS SDK's
 * `Uint8Array`. The caller receives and owns the copy and is responsible for zeroing it
 * (buf.fill(0)) after use. The original `Uint8Array` returned by the AWS SDK cannot be
 * zeroed from our code — it will be GC'd normally. This is an inherent Node.js / AWS SDK
 * limitation. The practical risk is low because the original reference is not stored anywhere
 * and V8 GC runs frequently, but it means in-memory forensics during the brief decrypt window
 * could theoretically find DEK bytes in the AWS SDK object. Documented here for future
 * reviewers; see also the analogous note on kepPassword in kepEncryptionService.ts.
 */
export async function decryptWithKMS(ciphertext: Buffer): Promise<Buffer> {
  const { Plaintext } = await getClient().send(
    new DecryptCommand({ CiphertextBlob: ciphertext, KeyId: getKeyId() })
  )

  if (!Plaintext) throw new Error('KMS Decrypt returned empty Plaintext')

  return Buffer.from(Plaintext)
}

/**
 * Generate a 256-bit Data Encryption Key (DEK) via KMS.
 *
 * Returns:
 *   plaintext  — raw AES key, use it to encrypt data locally, then discard
 *   ciphertext — KMS-encrypted copy of the key, safe to store in DB
 *
 * Never store plaintext. Retrieve the key later with decryptWithKMS(ciphertext).
 */
export async function generateDataKey(): Promise<{
  plaintext: Buffer
  ciphertext: Buffer
}> {
  const { Plaintext, CiphertextBlob } = await getClient().send(
    new GenerateDataKeyCommand({ KeyId: getKeyId(), KeySpec: 'AES_256' })
  )

  if (!Plaintext) throw new Error('KMS GenerateDataKey returned empty Plaintext')
  if (!CiphertextBlob) throw new Error('KMS GenerateDataKey returned empty CiphertextBlob')

  // Memory safety note: Buffer.from(Plaintext) copies the DEK from the AWS SDK Uint8Array.
  // The caller must zero `plaintext` (buf.fill(0)) after use. The SDK's original Uint8Array
  // cannot be zeroed from our code and will be GC'd. See decryptWithKMS() for full note.
  return {
    plaintext: Buffer.from(Plaintext),
    ciphertext: Buffer.from(CiphertextBlob),
  }
}
