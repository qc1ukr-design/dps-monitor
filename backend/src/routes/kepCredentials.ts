import { Router } from 'express'
import type { Request, Response, RequestHandler } from 'express'
import {
  encryptKep,
  activateKep,
  decryptKep,
  decryptKepByClientId,
  deleteKep,
  listKeps,
} from '../services/kepEncryptionService.js'
import { getSupabaseClient } from '../lib/supabase.js'

const router = Router()

// ---------------------------------------------------------------------------
// Auth middleware — verifies Supabase JWT, stores userId in res.locals
// Both X-Backend-Secret (checked by requireApiSecret in routes/index.ts) AND
// a valid JWT are required. userId is derived from the JWT, never from the
// request body or headers supplied by the caller.
// ---------------------------------------------------------------------------

const authMiddleware: RequestHandler = async (req, res, next) => {
  const header = req.headers['authorization']
  const token  = header?.startsWith('Bearer ') ? header.slice(7) : undefined

  if (!token) {
    res.status(401).json({ error: 'Authorization header with Supabase JWT required' })
    return
  }

  try {
    const { data, error } = await getSupabaseClient().auth.getUser(token)
    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid or expired token' })
      return
    }
    res.locals.userId = data.user.id
    next()
  } catch {
    res.status(401).json({ error: 'Token validation failed' })
  }
}

// UUID v4 format — guards against malformed / injected values
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

// ---------------------------------------------------------------------------
// POST /kep-credentials/upload
// ---------------------------------------------------------------------------
/**
 * Encrypt and store a KEP in kep_credentials (one active KEP per client).
 *
 * Body:
 *   clientId   — UUID of the client (clients.id)
 *   kepData    — raw KEP storage string (JSON v2 or legacy base64)
 *   password   — plaintext KEP password
 *   clientName — display name of the client
 *   edrpou     — ЄДРПОУ or РНОКПП of the client
 *   fileName   — original file name (optional)
 *
 * userId is taken from the verified Supabase JWT — NOT from the request body.
 */
router.post('/upload', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const userId = res.locals.userId as string

  const { clientId, kepData, password, clientName, edrpou, fileName } = req.body as {
    clientId:   string
    kepData:    string
    password:   string
    clientName: string
    edrpou:     string
    fileName?:  string
  }

  if (!clientId || !kepData || !password || !clientName || !edrpou) {
    res.status(400).json({ error: 'clientId, kepData, password, clientName, edrpou are required' })
    return
  }

  if (!isValidUuid(clientId)) {
    res.status(400).json({ error: 'clientId must be a valid UUID' })
    return
  }

  if (!/^\d{8,10}$/.test(edrpou)) {
    res.status(400).json({ error: 'edrpou має містити 8 цифр (ЄДРПОУ) або 10 цифр (РНОКПП)' })
    return
  }

  try {
    const kepFileBuffer = Buffer.from(kepData, 'utf8')
    let credential
    try {
      credential = await encryptKep({
        kepFileBuffer,
        kepPassword: password,
        userId,
        clientId,
        clientName,
        edrpou,
        fileName: fileName ?? '',
        isActive: false,
      })
    } finally {
      kepFileBuffer.fill(0)
    }

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
 *
 * Auth: Authorization: Bearer <supabase-jwt>
 */
router.get('/by-client/:clientId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params
  const userId = res.locals.userId as string

  if (!isValidUuid(clientId)) {
    res.status(400).json({ error: 'clientId must be a valid UUID' })
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
 * Auth: Authorization: Bearer <supabase-jwt>
 */
router.get('/:kepId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { kepId } = req.params
  const userId = res.locals.userId as string

  if (!isValidUuid(kepId)) {
    res.status(400).json({ error: 'kepId must be a valid UUID' })
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
 * Auth: Authorization: Bearer <supabase-jwt>
 */
router.delete('/:kepId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { kepId } = req.params
  const userId = res.locals.userId as string

  if (!isValidUuid(kepId)) {
    res.status(400).json({ error: 'kepId must be a valid UUID' })
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
 * List metadata for all active KEP credentials of the authenticated user.
 *
 * Auth: Authorization: Bearer <supabase-jwt>
 */
router.get('/', authMiddleware, async (_req: Request, res: Response): Promise<void> => {
  const userId = res.locals.userId as string

  try {
    const keps = await listKeps(userId)
    res.json(keps)
  } catch (err) {
    console.error('[kep-credentials] list error:', err)
    res.status(500).json({ error: 'Помилка отримання списку КЕП' })
  }
})

export default router
