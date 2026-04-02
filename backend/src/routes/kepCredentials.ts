import { Router } from 'express'
import type { Request, Response } from 'express'
import {
  encryptKep,
  activateKep,
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
    // Safe KEP replacement — 3 steps so the client is never left without an active KEP:
    //
    // Step 1: Encrypt and store the new KEP as INACTIVE.
    //         If this fails, the old KEP is untouched and still active.
    const kepFileBuffer = Buffer.from(kepData, 'utf8')
    const credential = await encryptKep({
      kepFileBuffer,
      kepPassword: password,
      userId,
      clientId,
      clientName,
      edrpou,
      fileName: fileName ?? '',
      isActive: false,
    })

    // Step 2 & 3: Deactivate old KEP(s), then activate the new one.
    //             If this fails, the new KEP is inactive and the old one stays active.
    await activateKep(credential.id, clientId, userId)

    res.json({ ok: true, kepId: credential.id })
  } catch (err) {
    console.error('[kep-credentials] upload error:', err)
    res.status(500).json({ error: 'Помилка збереження КЕП' })
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
    console.error('[kep-credentials] delete error:', err)
    res.status(500).json({ error: 'Помилка видалення КЕП' })
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
    console.error('[kep-credentials] list error:', err)
    res.status(500).json({ error: 'Помилка отримання списку КЕП' })
  }
})

export default router
