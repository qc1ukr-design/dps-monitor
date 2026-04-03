/**
 * kepRoutes.ts — Public KEP REST API (Supabase JWT auth)
 *
 * POST   /api/kep/upload      — upload + encrypt a KEP file
 * GET    /api/kep/list        — list current user's KEP metadata
 * DELETE /api/kep/:id         — delete a KEP
 * POST   /api/kep/:id/test    — verify KEP can be decrypted
 *
 * Auth: Authorization: Bearer <supabase-jwt>
 * Unlike the internal /kep routes, these are user-facing (browser / mobile).
 */

import { Router } from 'express'
import type { Request, Response, RequestHandler } from 'express'
import multer from 'multer'
import { rateLimit } from 'express-rate-limit'
import {
  encryptKep,
  activateKep,
  decryptKep,
  deleteKep,
  listKeps,
  KepNotFoundError,
} from '../services/kepEncryptionService.js'
import { getSupabaseClient } from '../lib/supabase.js'

const router = Router()

// UUID v4 format guard — prevents malformed values from reaching the DB
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isValidUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

// ---------------------------------------------------------------------------
// Auth middleware — validates Supabase JWT, stores userId in res.locals
// ---------------------------------------------------------------------------

const authMiddleware: RequestHandler = async (req, res, next) => {
  const header = req.headers['authorization']
  const token  = header?.startsWith('Bearer ') ? header.slice(7) : undefined

  if (!token) {
    res.status(401).json({ error: 'Authorization header required' })
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

// ---------------------------------------------------------------------------
// Rate limiting — 10 upload requests / hour / IP
// ---------------------------------------------------------------------------

const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Забагато запитів на завантаження, спробуй пізніше' },
})

// 20 test/delete requests per hour per IP — each test call hits AWS KMS
const sensitiveOpRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Забагато запитів, спробуй пізніше' },
})

// ---------------------------------------------------------------------------
// Multer — memory storage only (no disk writes), 5 MB limit
// ---------------------------------------------------------------------------

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
})

/** Wraps upload.single() to convert MulterError into fixed HTTP responses (H-5). */
function multerSingle(fieldName: string): RequestHandler {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'Файл перевищує максимальний розмір 5 MB' })
          return
        }
        // Other multer errors — fixed string, not err.message
        res.status(400).json({ error: 'Помилка обробки файлу' })
        return
      }
      if (err) {
        // Unexpected error — fixed string, log internally (H-2: only message, never full object)
        console.error('[kep] multer unexpected error:', err instanceof Error ? err.message : String(err))
        res.status(400).json({ error: 'Помилка обробки файлу' })
        return
      }
      next()
    })
  }
}

// ---------------------------------------------------------------------------
// POST /api/kep/upload
// ---------------------------------------------------------------------------

router.post(
  '/upload',
  uploadRateLimit,
  authMiddleware,
  multerSingle('file'),
  async (req: Request, res: Response): Promise<void> => {
    const userId = res.locals.userId as string

    if (!req.file) {
      res.status(400).json({ error: 'Файл КЕП обов\'язковий (поле: file)' })
      return
    }

    const { password, clientName, edrpou, clientId } = req.body as Record<string, string>

    if (!password)   { res.status(400).json({ error: 'password є обов\'язковим' });    return }
    if (!clientName) { res.status(400).json({ error: 'clientName є обов\'язковим' });  return }
    if (!edrpou)     { res.status(400).json({ error: 'edrpou є обов\'язковим' });      return }
    if (!/^\d{8,10}$/.test(edrpou)) {
      res.status(400).json({ error: 'edrpou має містити 8 цифр (ЄДРПОУ) або 10 цифр (РНОКПП)' })
      return
    }

    // C-2: keep a reference to zero the buffer in all code paths
    const kepFileBuffer = req.file.buffer
    try {
      const credential = await encryptKep({
        kepFileBuffer,
        kepPassword:   password,
        userId,
        clientId:      clientId || undefined,
        clientName,
        edrpou,
        fileName:      req.file.originalname,
        isActive:      false,
      })

      // Pass clientId (or null) — the atomic function skips deactivation when null
      await activateKep(credential.id, clientId || null, userId)

      res.status(201).json({
        id:         credential.id,
        clientName: credential.clientName,
        edrpou:     credential.edrpou,
        fileName:   credential.fileName,
        createdAt:  credential.createdAt,
      })
    } catch (err) {
      console.error('[kep] upload error:', err instanceof Error ? err.message : String(err))
      res.status(500).json({ error: 'Помилка завантаження КЕП' })
    } finally {
      // C-2: zero plaintext KEP bytes regardless of success or failure
      kepFileBuffer.fill(0)
    }
  }
)

// ---------------------------------------------------------------------------
// GET /api/kep/list
// ---------------------------------------------------------------------------

router.get('/list', authMiddleware, async (_req: Request, res: Response): Promise<void> => {
  try {
    const keps = await listKeps(res.locals.userId as string)
    res.json(keps)
  } catch (err) {
    console.error('[kep] list error:', err instanceof Error ? err.message : String(err))
    res.status(500).json({ error: 'Помилка отримання списку КЕП' })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/kep/:id
// ---------------------------------------------------------------------------

router.delete('/:id', sensitiveOpRateLimit, authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params

  if (!isValidUuid(id)) {
    res.status(400).json({ error: 'id must be a valid UUID' })
    return
  }

  try {
    await deleteKep(id, res.locals.userId as string)
    res.json({ success: true })
  } catch (err) {
    // H-4: distinguish 404 by type, not by regex on err.message
    if (err instanceof KepNotFoundError) {
      res.status(404).json({ error: 'КЕП не знайдено' })
      return
    }
    console.error('[kep] delete error:', err instanceof Error ? err.message : String(err))
    res.status(500).json({ error: 'Помилка видалення КЕП' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/kep/:id/test
// ---------------------------------------------------------------------------

router.post('/:id/test', sensitiveOpRateLimit, authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { id }   = req.params
  const userId   = res.locals.userId as string

  if (!isValidUuid(id)) {
    res.json({ success: false, error: 'id must be a valid UUID' })
    return
  }

  // P3.4: pass 'KEP_TEST' so kep_access_log distinguishes test-decrypt from real DPS syncs.
  // Requires migration 010 to have been applied (adds KEP_TEST to the action check constraint).
  let decrypted
  try {
    decrypted = await decryptKep(id, userId, 'KEP_TEST')
  } catch (err) {
    // H-3: never expose err.message to the client — it may contain internal details
    console.error('[kep] test decrypt error:', err instanceof Error ? err.message : String(err))
    res.json({ success: false, error: 'Не вдалось розшифрувати КЕП' })
    return
  }

  try {
    const { data } = await getSupabaseClient()
      .from('kep_credentials')
      .select('client_name, edrpou')
      .eq('id', id)
      .eq('user_id', userId)
      .limit(1)

    const row = (data && data.length > 0) ? data[0] as { client_name: string; edrpou: string } : null
    res.json({
      success:    true,
      clientName: row?.client_name ?? null,
      edrpou:     row?.edrpou      ?? null,
    })
  } finally {
    decrypted.cleanup()
  }
})

export default router
