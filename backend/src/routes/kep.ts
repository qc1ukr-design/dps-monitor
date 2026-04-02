import { Router } from 'express'
import type { Request, Response } from 'express'
import { getSupabaseClient } from '../lib/supabase.js'
import { kmsEncrypt, serializeEnvelope } from '../lib/kms.js'
import { decryptKepByClientId } from '../services/kepEncryptionService.js'

const router = Router()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// UUID v4 format guard
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isValidUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

// ---------------------------------------------------------------------------
// POST /kep/upload
// ---------------------------------------------------------------------------
/**
 * Store KEP for a client, encrypted with KMS envelope encryption.
 *
 * Body:
 *   clientId   — UUID of the client
 *   userId     — UUID of the Supabase user (for RLS-equivalent filtering)
 *   kepData    — raw KEP storage string (JSON v2 or legacy base64)
 *   password   — plaintext KEP password
 *   kepInfo    — { caName, ownerName, orgName?, taxId, validTo? }
 *
 * NOTE (H-1): userId is trusted from the request body — this is a legacy route
 * protected only by X-Backend-Secret. The caller (web/app/api/clients/[id]/kep/route.ts)
 * derives userId from a verified Supabase session, which mitigates the risk under
 * normal operation. This route will be replaced by /kep-credentials/upload (which
 * requires a Supabase JWT) when Крок D is executed.
 */
router.post('/upload', async (req: Request, res: Response): Promise<void> => {
  const { clientId, userId, kepData, password, kepInfo } = req.body as {
    clientId: string
    userId: string
    kepData: string
    password: string
    kepInfo: {
      caName: string
      ownerName: string
      orgName?: string
      taxId: string
      validTo?: string | null
    }
  }

  if (!clientId || !userId || !kepData || !password || !kepInfo) {
    res.status(400).json({ error: 'clientId, userId, kepData, password, kepInfo are required' })
    return
  }

  // M-2: validate UUID format before using as DB filter values
  if (!isValidUuid(clientId)) {
    res.status(400).json({ error: 'clientId must be a valid UUID' })
    return
  }
  if (!isValidUuid(userId)) {
    res.status(400).json({ error: 'userId must be a valid UUID' })
    return
  }

  const supabase = getSupabaseClient()

  // Verify the client belongs to this user (safety check even with service role)
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('user_id', userId)
    .single()

  if (!client) {
    res.status(404).json({ error: 'Client not found' })
    return
  }

  // Encrypt with KMS envelope encryption
  const [kepEncrypted, kepPasswordEncrypted] = await Promise.all([
    kmsEncrypt(kepData).then(serializeEnvelope),
    kmsEncrypt(password).then(serializeEnvelope),
  ])

  const kepFields = {
    kep_encrypted: kepEncrypted,
    kep_password_encrypted: kepPasswordEncrypted,
    kep_ca_name: kepInfo.caName,
    kep_owner_name: kepInfo.ownerName,
    kep_valid_to: kepInfo.validTo ?? null,
    kep_tax_id: kepInfo.taxId,
    updated_at: new Date().toISOString(),
  }

  // Upsert: update if row exists, insert if not
  const { data: existing } = await supabase
    .from('api_tokens')
    .select('id')
    .eq('client_id', clientId)
    .eq('user_id', userId)
    .single()

  const { error } = existing
    ? await supabase
        .from('api_tokens')
        .update(kepFields)
        .eq('client_id', clientId)
        .eq('user_id', userId)
    : await supabase
        .from('api_tokens')
        .insert({ client_id: clientId, user_id: userId, ...kepFields })

  if (error) {
    // H-2: never expose raw Supabase error.message to the client; log only .message (not full object)
    console.error('[kep] upsert error:', error?.message ?? String(error))
    res.status(500).json({ error: 'Помилка збереження КЕП' })
    return
  }

  // Persist org name if provided (migration 004 field — ignore if column missing)
  if (kepInfo.orgName) {
    await supabase
      .from('api_tokens')
      .update({ kep_org_name: kepInfo.orgName } as Record<string, string>)
      .eq('client_id', clientId)
      .eq('user_id', userId)
  }

  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// GET /kep/:clientId
// ---------------------------------------------------------------------------
/**
 * Retrieve and decrypt KEP for a client.
 *
 * Query params:
 *   userId — UUID of the Supabase user
 *
 * Returns:
 *   { kepData: string, password: string }
 *
 * Dual-read: tries kep_credentials (new) first, falls back to api_tokens (legacy).
 * Called by /web DPS sync to get the raw KEP + password for signing.
 */
// Крок E (2026-04-02): fallback to api_tokens removed — all 6 clients verified
// in kep_credentials (Крок C). Reads exclusively from kep_credentials now.
router.get('/:clientId', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  const { userId } = req.query as { userId?: string }

  if (!userId) {
    res.status(400).json({ error: 'userId query param is required' })
    return
  }

  if (!isValidUuid(clientId)) {
    res.status(400).json({ error: 'clientId must be a valid UUID' })
    return
  }
  if (!isValidUuid(userId)) {
    res.status(400).json({ error: 'userId must be a valid UUID' })
    return
  }

  let decrypted
  try {
    decrypted = await decryptKepByClientId(clientId, userId)
  } catch {
    res.status(404).json({ error: 'KEP not found' })
    return
  }

  try {
    res.json({
      kepData:  decrypted.kepFileBuffer.toString('utf8'),
      password: decrypted.kepPassword,
    })
  } finally {
    decrypted.cleanup()
  }
})

export default router
