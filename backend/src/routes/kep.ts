import { Router } from 'express'
import type { Request, Response } from 'express'
import { decryptKepByClientId } from '../services/kepEncryptionService.js'

// NOTE: POST /kep/upload was removed (2026-04-02, Крок D cleanup).
// New uploads go to POST /kep-credentials/upload (JWT-authenticated).

const router = Router()

// UUID v4 format guard
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isValidUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

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
 * Called by sync-all cron (web/app/api/cron/sync-all/route.ts) which runs
 * as a service_role client and does not have individual user JWTs.
 *
 * Security note (P5): userId is trusted from the query param, not from a JWT.
 * This is protected by X-Backend-Secret + CRON_SECRET chain. The userId value
 * comes from api_tokens table (server-side), not user input. Migration path:
 * when sync-all is refactored to read kep_credentials directly, this route
 * should be removed and replaced by GET /kep-credentials/by-client/:clientId
 * (JWT-authenticated, userId derived server-side from verified token).
 *
 * Крок E (2026-04-02): reads exclusively from kep_credentials.
 */
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
