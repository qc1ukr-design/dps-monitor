/**
 * KEP Envelope Encryption Service
 *
 * Implements per-KEP envelope encryption:
 *   - One unique DEK (AES-256) per KEP, generated via AWS KMS GenerateDataKey
 *   - KEP file buffer and password encrypted separately with that DEK
 *   - Only the KMS-encrypted DEK is persisted; plaintext DEK is zeroed immediately
 *   - Decrypted material is zeroed via the cleanup() callback after use
 *
 * Storage: kep_credentials table (migration 005)
 * Audit:   kep_access_log table  (migration 005)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { generateDataKey, decryptWithKMS } from '../lib/kmsClient.js'
import { getSupabaseClient } from '../lib/supabase.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm' as const
const IV_BYTES   = 12  // 96-bit IV — recommended for GCM
const TAG_BYTES  = 16  // 128-bit authentication tag

// ---------------------------------------------------------------------------
// Public error types
// ---------------------------------------------------------------------------

/**
 * Thrown by deleteKep() when the KEP does not exist or is not owned by userId.
 * Allows callers to distinguish 404 from 500 by type rather than message content.
 */
export class KepNotFoundError extends Error {
  constructor(message = 'KEP not found or not owned by this user') {
    super(message)
    this.name = 'KepNotFoundError'
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Full row returned after a successful encryptKep() call.
 * Never contains blob or key material.
 */
export interface KepCredential {
  id:          string
  userId:      string
  clientId:    string | null
  clientName:  string
  edrpou:      string
  fileName:    string | null
  fileSize:    number | null
  isActive:    boolean
  lastUsedAt:  string | null
  createdAt:   string
  updatedAt:   string
}

/**
 * Row returned by listKeps().
 * Identical to KepCredential minus userId — safe to send to the frontend.
 */
export interface KepMetadata {
  id:          string
  clientName:  string
  edrpou:      string
  fileName:    string | null
  fileSize:    number | null
  isActive:    boolean
  lastUsedAt:  string | null
  createdAt:   string
  updatedAt:   string
}

/**
 * Decrypted KEP material returned by decryptKep().
 * Caller MUST invoke cleanup() after signing to zero memory.
 *
 * Note: kepPassword is a JS string — immutable in V8, cannot be zeroed.
 * The underlying passwordBuffer IS zeroed by cleanup(). The string copy
 * will be GC'd normally. This is an inherent Node.js limitation.
 */
export interface DecryptedKep {
  kepFileBuffer: Buffer
  kepPassword:   string
  /** Zero kepFileBuffer and the internal passwordBuffer in memory. */
  cleanup: () => void
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Encrypt a Buffer with AES-256-GCM using the supplied key.
 * Returns a compact base64 blob: `<iv>:<tag>:<ciphertext>` (all base64).
 */
function aesGcmEncryptBuffer(plaintext: Buffer, key: Buffer): string {
  const iv     = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ct     = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag    = cipher.getAuthTag()

  return [
    iv.toString('base64'),
    tag.toString('base64'),
    ct.toString('base64'),
  ].join(':')
}

/**
 * Decrypt a blob produced by aesGcmEncryptBuffer().
 * Returns a Buffer; caller owns the memory and is responsible for zeroing.
 */
function aesGcmDecryptBuffer(blob: string, key: Buffer): Buffer {
  const parts = blob.split(':')
  if (parts.length !== 3) {
    throw new Error('kepEncryptionService: malformed blob — expected iv:tag:ciphertext')
  }

  const [ivB64, tagB64, ctB64] = parts
  const iv       = Buffer.from(ivB64,  'base64')
  const tag      = Buffer.from(tagB64, 'base64')
  const ct       = Buffer.from(ctB64,  'base64')

  if (iv.length !== IV_BYTES) {
    throw new Error(`kepEncryptionService: invalid IV length ${iv.length}`)
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`kepEncryptionService: invalid tag length ${tag.length}`)
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(ct), decipher.final()])
}

/**
 * Sanitize an error message before writing it to the audit log (M-2).
 * Strips AWS ARN patterns and truncates to 500 chars to prevent accidental
 * leakage of internal details if the log is ever exported or queried.
 */
function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/arn:aws:[^\s"']+/gi, '[ARN]')   // strip AWS ARNs
    .slice(0, 500)
}

/** Write a log entry to kep_access_log — never throws (errors are swallowed). */
async function writeAuditLog(entry: {
  kepId:        string | null
  userId:       string
  action:       'UPLOAD' | 'USE_FOR_DPS' | 'DELETE' | 'VIEW_LIST'
  success:      boolean
  errorMessage: string | null
}): Promise<void> {
  try {
    const supabase = getSupabaseClient()
    await supabase.from('kep_access_log').insert({
      kep_id:        entry.kepId,
      user_id:       entry.userId,
      action:        entry.action,
      success:       entry.success,
      error_message: entry.errorMessage,
    })
  } catch {
    // Audit log write failure must not surface to the caller
  }
}

/** Read the KMS CMK ARN from env — throws if not configured. */
function getKmsKeyId(): string {
  const keyId = process.env.AWS_KMS_KEY_ID
  if (!keyId) throw new Error('AWS_KMS_KEY_ID is not set')
  return keyId
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt a KEP file and its password, then persist to kep_credentials.
 *
 * One unique DEK is generated per KEP. The DEK plaintext is zeroed as soon as
 * both blobs are encrypted. Only the KMS-wrapped DEK is stored.
 */
export async function encryptKep(params: {
  kepFileBuffer: Buffer
  kepPassword:   string
  userId:        string
  clientId?:     string   // FK to clients.id — nullable during initial creation, filled by backfill
  clientName:    string
  edrpou:        string
  fileName:      string
  isActive?:     boolean  // defaults to true; pass false to store inactive until old KEP is deactivated
  // Certificate metadata (migration 008) — informational only, never used for crypto
  caName?:       string | null
  ownerName?:    string | null
  orgName?:      string | null
  taxId?:        string | null
  validTo?:      string | null
}): Promise<KepCredential> {
  const {
    kepFileBuffer, kepPassword, userId, clientId, clientName, edrpou, fileName, isActive = true,
    caName, ownerName, orgName, taxId, validTo,
  } = params

  let dek: Buffer | null = null

  try {
    // 1. Generate a unique DEK for this KEP
    const { plaintext, ciphertext: encryptedDekBytes } = await generateDataKey()
    dek = plaintext

    // 2. Encrypt KEP file and password with the DEK
    const encryptedKepBlob      = aesGcmEncryptBuffer(kepFileBuffer,                    dek)
    const encryptedPasswordBlob = aesGcmEncryptBuffer(Buffer.from(kepPassword, 'utf8'), dek)

    // 3. Zero the DEK plaintext — we no longer need it
    dek.fill(0)
    dek = null

    // 4. Persist to kep_credentials
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('kep_credentials')
      .insert({
        user_id:                userId,
        client_id:              clientId ?? null,
        client_name:            clientName,
        edrpou,
        file_name:              fileName || null,
        file_size:              kepFileBuffer.length,
        encrypted_kep_blob:     encryptedKepBlob,
        encrypted_password_blob: encryptedPasswordBlob,
        encrypted_dek:          encryptedDekBytes.toString('base64'),
        kms_key_id:             getKmsKeyId(),
        is_active:              isActive,
        // Certificate metadata (migration 008)
        ca_name:    caName    ?? null,
        owner_name: ownerName ?? null,
        org_name:   orgName   ?? null,
        tax_id:     taxId     ?? null,
        valid_to:   validTo   ?? null,
      })
      .select('id, user_id, client_id, client_name, edrpou, file_name, file_size, is_active, last_used_at, created_at, updated_at')
      .single()

    if (error || !data) {
      throw new Error(error?.message ?? 'kep_credentials insert returned no data')
    }

    await writeAuditLog({ kepId: data.id, userId, action: 'UPLOAD', success: true, errorMessage: null })

    return {
      id:          data.id,
      userId:      data.user_id,
      clientId:    data.client_id ?? null,
      clientName:  data.client_name,
      edrpou:      data.edrpou,
      fileName:    data.file_name,
      fileSize:    data.file_size,
      isActive:    data.is_active,
      lastUsedAt:  data.last_used_at,
      createdAt:   data.created_at,
      updatedAt:   data.updated_at,
    }
  } catch (err) {
    // Ensure DEK is zeroed even on failure
    if (dek !== null) {
      dek.fill(0)
      dek = null
    }

    await writeAuditLog({
      kepId:        null,
      userId,
      action:       'UPLOAD',
      success:      false,
      errorMessage: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
    })

    throw err
  }
}

/**
 * Decrypt a KEP credential and return the raw file buffer + password.
 *
 * The DEK is fetched from KMS and zeroed immediately after decryption.
 * The caller MUST invoke cleanup() after signing to zero decrypted material.
 */
export async function decryptKep(kepId: string, userId: string): Promise<DecryptedKep> {
  let dek: Buffer | null = null

  try {
    const supabase = getSupabaseClient()

    // 1. Fetch encrypted blobs — verify ownership via user_id
    const { data, error } = await supabase
      .from('kep_credentials')
      .select('encrypted_kep_blob, encrypted_password_blob, encrypted_dek, kms_key_id, is_active')
      .eq('id', kepId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle()

    if (error || !data) {
      throw new Error('KEP not found or not active')
    }

    const {
      encrypted_kep_blob,
      encrypted_password_blob,
      encrypted_dek,
    } = data as {
      encrypted_kep_blob:      string
      encrypted_password_blob: string
      encrypted_dek:           string
      kms_key_id:              string
      is_active:               boolean
    }

    // 2. Unwrap the DEK via KMS
    const encryptedDekBytes = Buffer.from(encrypted_dek, 'base64')
    dek = await decryptWithKMS(encryptedDekBytes)

    // 3. Decrypt KEP file and password
    const kepFileBuffer  = aesGcmDecryptBuffer(encrypted_kep_blob,      dek)
    const passwordBuffer = aesGcmDecryptBuffer(encrypted_password_blob, dek)

    // 4. Zero the DEK — no longer needed
    dek.fill(0)
    dek = null

    const kepPassword = passwordBuffer.toString('utf8')

    // 5. Update last_used_at (best-effort, don't throw on failure)
    supabase
      .from('kep_credentials')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', kepId)
      .eq('user_id', userId)
      .then(() => {/* intentionally ignored */})

    await writeAuditLog({ kepId, userId, action: 'USE_FOR_DPS', success: true, errorMessage: null })

    // 6. Return decrypted material + cleanup function
    // M-1: cleaned flag prevents double-zeroing from masking accidental re-use
    let cleaned = false
    return {
      kepFileBuffer,
      kepPassword,
      cleanup: () => {
        if (cleaned) return
        cleaned = true
        kepFileBuffer.fill(0)
        passwordBuffer.fill(0)
      },
    }
  } catch (err) {
    if (dek !== null) {
      dek.fill(0)
      dek = null
    }

    await writeAuditLog({
      kepId,
      userId,
      action:       'USE_FOR_DPS',
      success:      false,
      errorMessage: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
    })

    throw err
  }
}

/**
 * Convenience wrapper: look up the active KEP for a client, then decrypt it.
 *
 * Used by the sync flow which only knows clientId, not kepId.
 * Throws if no active kep_credentials row exists for this client.
 */
export async function decryptKepByClientId(clientId: string, userId: string): Promise<DecryptedKep> {
  const supabase = getSupabaseClient()

  const { data, error } = await supabase
    .from('kep_credentials')
    .select('id')
    .eq('client_id', clientId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) {
    throw new Error('KEP not found in kep_credentials for this client')
  }

  return decryptKep(data[0].id, userId)
}

/**
 * Hard-delete a KEP credential.
 *
 * The audit log row is preserved (ON DELETE SET NULL on kep_id).
 * Only the owner (userId) can delete their own KEP.
 */
export async function deleteKep(kepId: string, userId: string): Promise<void> {
  try {
    const supabase = getSupabaseClient()

    // Verify ownership before deletion
    const { data: existingRows } = await supabase
      .from('kep_credentials')
      .select('id')
      .eq('id', kepId)
      .eq('user_id', userId)
      .limit(1)

    if (!existingRows || existingRows.length === 0) {
      throw new KepNotFoundError()
    }

    const { error } = await supabase
      .from('kep_credentials')
      .delete()
      .eq('id', kepId)
      .eq('user_id', userId)

    if (error) {
      throw new Error(error.message)
    }

    // kep_id in audit log becomes NULL via ON DELETE SET NULL
    await writeAuditLog({ kepId, userId, action: 'DELETE', success: true, errorMessage: null })
  } catch (err) {
    await writeAuditLog({
      kepId,
      userId,
      action:       'DELETE',
      success:      false,
      errorMessage: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
    })

    throw err
  }
}

/**
 * Activate a KEP by id and deactivate all other active KEPs for the same client.
 *
 * Used as the final step of safe KEP replacement:
 *   1. encryptKep(..., isActive: false)  — store new KEP inactive
 *   2. activateKep(newId, clientId, userId) — atomically swap active flag
 *
 * If this step fails the new KEP remains inactive and the old one stays active,
 * so the client is never left without a working KEP.
 */
export async function activateKep(kepId: string, clientId: string | null, userId: string): Promise<void> {
  const supabase = getSupabaseClient()

  // M-5: verify ownership before calling the atomic RPC — defense-in-depth in case
  // the SQL function's WHERE clause ever drifts from the expected behavior.
  const { data: ownerCheck } = await supabase
    .from('kep_credentials')
    .select('id')
    .eq('id', kepId)
    .eq('user_id', userId)
    .limit(1)

  if (!ownerCheck || ownerCheck.length === 0) {
    throw new KepNotFoundError(`KEP ${kepId} not found or not owned by user ${userId}`)
  }

  // Both UPDATEs execute atomically inside the PostgreSQL function (migration 007).
  // If activation fails, the old KEP remains active — client is never left without a KEP.
  const { error } = await supabase.rpc('activate_kep_atomic', {
    p_kep_id:    kepId,
    p_client_id: clientId || null,
    p_user_id:   userId,
  })

  if (error) {
    throw new Error(`Failed to activate KEP: ${error.message}`)
  }
}

/**
 * List metadata for all active KEP credentials belonging to userId.
 * Never returns encrypted blobs or key material.
 */
export async function listKeps(userId: string): Promise<KepMetadata[]> {
  try {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase
      .from('kep_credentials')
      .select('id, client_name, edrpou, file_name, file_size, is_active, last_used_at, created_at, updated_at')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(error.message)
    }

    await writeAuditLog({ kepId: null, userId, action: 'VIEW_LIST', success: true, errorMessage: null })

    return (data ?? []).map((row) => ({
      id:          row.id,
      clientName:  row.client_name,
      edrpou:      row.edrpou,
      fileName:    row.file_name,
      fileSize:    row.file_size,
      isActive:    row.is_active,
      lastUsedAt:  row.last_used_at,
      createdAt:   row.created_at,
      updatedAt:   row.updated_at,
    }))
  } catch (err) {
    await writeAuditLog({
      kepId:        null,
      userId,
      action:       'VIEW_LIST',
      success:      false,
      errorMessage: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
    })

    throw err
  }
}
