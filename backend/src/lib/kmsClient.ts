import {
  KMSClient,
  EncryptCommand,
  DecryptCommand,
  GenerateDataKeyCommand,
} from '@aws-sdk/client-kms'

let _client: KMSClient | null = null

function getClient(): KMSClient {
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

  return {
    plaintext: Buffer.from(Plaintext),
    ciphertext: Buffer.from(CiphertextBlob),
  }
}
