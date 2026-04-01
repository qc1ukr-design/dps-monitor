import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import type { KmsEnvelope } from '../types/index.js'

const ALGORITHM = 'aes-256-gcm'

let _kmsClient: KMSClient | null = null

function getKmsClient(): KMSClient {
  if (_kmsClient) return _kmsClient

  const region = process.env.AWS_REGION
  if (!region) throw new Error('AWS_REGION must be set')

  _kmsClient = new KMSClient({ region })
  return _kmsClient
}

function getKmsKeyId(): string {
  const keyId = process.env.AWS_KMS_KEY_ID
  if (!keyId) throw new Error('AWS_KMS_KEY_ID must be set')
  return keyId
}

/**
 * Encrypt plaintext using envelope encryption:
 *   1. Ask KMS to generate a 256-bit data key (plaintext + encrypted copy)
 *   2. Encrypt the payload locally with AES-256-GCM using the plaintext data key
 *   3. Discard the plaintext data key — store only the KMS-encrypted copy
 *
 * Returns a KmsEnvelope that can be stored in DB or passed between services.
 */
export async function kmsEncrypt(plaintext: string): Promise<KmsEnvelope> {
  const kms = getKmsClient()
  const kmsKeyId = getKmsKeyId()

  const { Plaintext, CiphertextBlob } = await kms.send(
    new GenerateDataKeyCommand({ KeyId: kmsKeyId, KeySpec: 'AES_256' })
  )

  if (!Plaintext || !CiphertextBlob) {
    throw new Error('KMS GenerateDataKey returned empty Plaintext or CiphertextBlob')
  }

  const dataKey = Buffer.from(Plaintext)
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, dataKey, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  // Zero out the plaintext data key from memory
  dataKey.fill(0)

  return {
    version: 1,
    kmsKeyId,
    encryptedDataKey: Buffer.from(CiphertextBlob).toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  }
}

/**
 * Decrypt a KmsEnvelope:
 *   1. Ask KMS to decrypt the encrypted data key
 *   2. Decrypt the payload locally with AES-256-GCM
 *   3. Discard the plaintext data key
 */
export async function kmsDecrypt(envelope: KmsEnvelope): Promise<string> {
  const kms = getKmsClient()

  const { Plaintext } = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(envelope.encryptedDataKey, 'base64'),
      KeyId: envelope.kmsKeyId,
    })
  )

  if (!Plaintext) {
    throw new Error('KMS Decrypt returned empty Plaintext')
  }

  const dataKey = Buffer.from(Plaintext)
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')

  const decipher = createDecipheriv(ALGORITHM, dataKey, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  dataKey.fill(0)

  return decrypted.toString('utf8')
}

/**
 * Serialize a KmsEnvelope to a single string for DB storage.
 * Format: base64(JSON(envelope))
 */
export function serializeEnvelope(envelope: KmsEnvelope): string {
  return Buffer.from(JSON.stringify(envelope)).toString('base64')
}

/**
 * Deserialize a KmsEnvelope from a DB-stored string.
 * Throws if the payload is not a valid v1 envelope.
 */
export function deserializeEnvelope(stored: string): KmsEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(stored, 'base64').toString('utf8'))
  } catch {
    throw new Error('kmsDeserialize: invalid base64/JSON payload')
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as KmsEnvelope).version !== 1
  ) {
    throw new Error('kmsDeserialize: not a v1 KmsEnvelope')
  }

  return parsed as KmsEnvelope
}
