import { Router } from 'express'
import type { Request, Response } from 'express'
import {
  encryptKep,
  decryptKep,
  decryptKepByClientId,
  deleteKep,
  listKeps,
} from '../services/kepEncryptionService.js'

const router = Router()

// ---------------------------------------------------------------------------
// POST /kep-credentials/upload
// ---------------------------------------------------------------------------
/**
 * Encrypt and store a KEP in kep_credentials (one active KEP per client).
 *
 * Body:
 *   clientId   — UUID of the client (clients.id)
 *   userId     — UUID of the Supabase user
 *   kepData    — raw KEP storage string (JSON v2 or legacy base64)
 *   password   — plaintext KEP password
 *   clientName — display name of the client
 *   edrpou     — ЄДРПОУ or РНОКПП of the client
 *   fileName   — original file name (optional)
 *
 * If an active KEP already exists for this client, deactivate it first,
 * then insert the new one (atomic certificate renewal).
 */
router.post('/upload', async (req: Request, res: Response): Promise<void> => {
  const { clientId, userId, kepData, password, clientName, edrpou, fileName } = req.body as {
    clientId:   string
    userId:     string
    kepData:    string
    password:   string
    clientName: string
    edrpou:     string
    fileName?:  string
  }

  if (!clientId || !userId || !kepData || !password || !clientName || !edrpou) {
    res.status(400).json({ error: 'clientId, userId, kepData, password, clientName, edrpou are required' })
    return
  }

  try {
    // Deactivate any existing active KEP for this client before inserting a new one.
    // This maintains the one-active-per-client invariant enforced by the partial unique index.
    const { getSupabaseClient } = await import('../lib/supabase.js')
    const supabase = getSupabaseClient()
    await supabase
      .from('kep_credentials')
      .update({ is_active: false })
      .eq('client_id', clientId)
      .eq('user_id', userId)
      .eq('is_active', true)

    // kepData is a storage string (JSON v2 or legacy base64) — encode as Buffer for the service
    const kepFileBuffer = Buffer.from(kepData, 'utf8')

    const credential = await encryptKep({
      kepFileBuffer,
      kepPassword: password,
      userId,
      clientId,
      clientName,
      edrpou,
      fileName: fileName ?? '',
    })

    res.json({ ok: true, kepId: credential.id })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ---------------------------------------------------------------------------
// GET /kep-credentials/by-client/:clientId
// ---------------------------------------------------------------------------
/**
 * Decrypt and return the active KEP for a given client.
 * Used by the sync flow — returns the same shape as GET /kep/:clientId.
 *
 * Query params:
 *   userId — UUID of the Supabase user
 */
router.get('/by-client/:clientId', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  const { userId } = req.query as { userId?: string }

  if (!userId) {
    res.status(400).json({ error: 'userId query param is required' })
    return
  }

  let decrypted
  try {
    decrypted = await decryptKepByClientId(clientId, userId)
  } catch {
    res.status(404).json({ error: 'KEP not found for this client' })
    return
  }

  try {
    // kepFileBuffer contains UTF-8 encoded kepStorageValue string
    const kepData = decrypted.kepFileBuffer.toString('utf8')
    const kepPassword = decrypted.kepPassword
    res.json({ kepData, password: kepPassword })
  } finally {
    decrypted.cleanup()
  }
})

// ---------------------------------------------------------------------------
// GET /kep-credentials/:kepId
// ---------------------------------------------------------------------------
/**
 * Decrypt and return a KEP by its own ID.
 *
 * Query params:
 *   userId — UUID of the Supabase user
 */
router.get('/:kepId', async (req: Request, res: Response): Promise<void> => {
  const { kepId } = req.params
  const { userId } = req.query as { userId?: string }

  if (!userId) {
    res.status(400).json({ error: 'userId query param is required' })
    return
  }

  let decrypted
  try {
    decrypted = await decryptKep(kepId, userId)
  } catch {
    res.status(404).json({ error: 'KEP not found' })
    return
  }

  try {
    const kepData = decrypted.kepFileBuffer.toString('utf8')
    const kepPassword = decrypted.kepPassword
    res.json({ kepData, password: kepPassword })
  } finally {
    decrypted.cleanup()
  }
})

// ---------------------------------------------------------------------------
// DELETE /kep-credentials/:kepId
// ---------------------------------------------------------------------------
/**
 * Hard-delete a KEP credential (audit log preserved).
 *
 * Query params:
 *   userId — UUID of the Supabase user
 */
router.delete('/:kepId', async (req: Request, res: Response): Promise<void> => {
  const { kepId } = req.params
  const { userId } = req.query as { userId?: string }

  if (!userId) {
    res.status(400).json({ error: 'userId query param is required' })
    return
  }

  try {
    await deleteKep(kepId, userId)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ---------------------------------------------------------------------------
// GET /kep-credentials
// ---------------------------------------------------------------------------
/**
 * List metadata for all active KEP credentials of a user (no blobs).
 *
 * Query params:
 *   userId — UUID of the Supabase user
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.query as { userId?: string }

  if (!userId) {
    res.status(400).json({ error: 'userId query param is required' })
    return
  }

  try {
    const keps = await listKeps(userId)
    res.json(keps)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

export default router
