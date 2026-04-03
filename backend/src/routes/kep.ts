import { Router } from 'express'
import type { Request, Response } from 'express'
import { decryptKepByClientIdInternal } from '../services/kepEncryptionService.js'

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
 * Returns:
 *   { kepData: string, password: string }
 *
 * Called by sync-all cron (web/app/api/cron/sync-all/route.ts).
 *
 * Security: userId is NOT accepted from the request — it is read from the
 * kep_credentials row by decryptKepByClientId(). This eliminates the P5 risk
 * of trusting a caller-supplied userId. The route is protected by X-Backend-Secret.
 */
router.get('/:clientId', async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params

  if (!isValidUuid(clientId)) {
    res.status(400).json({ error: 'clientId must be a valid UUID' })
    return
  }

  let decrypted
  try {
    decrypted = await decryptKepByClientIdInternal(clientId)
  } catch {
    res.status(404).json({ error: 'KEP not found' })
    return
  }

  try {
    // P5.2: jkurwa stores KEP files as JSON v2 strings — valid UTF-8 — so toString('utf8')
    // is safe here. If a binary (.p12/.pfx) KEP is ever used, switch to 'base64' and update
    // the corresponding Buffer.from() call on the upload path in kepCredentials.ts.
    res.json({
      kepData:  decrypted.kepFileBuffer.toString('utf8'),
      password: decrypted.kepPassword,
    })
  } finally {
    decrypted.cleanup()
  }
})

export default router
