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
} from '../services/kepEncryptionService.js'
import { getSupabaseClient } from '../lib/supabase.js'

const router = Router()

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

/** Wraps upload.single() to convert MulterError into proper HTTP responses. */
function multerSingle(fieldName: string): RequestHandler {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: 'Файл перевищує максимальний розмір 5 MB' })
          return
        }
        res.status(400).json({ error: err.message })
        return
      }
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
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

    try {
      // Safe KEP replacement: store inactive first, then swap active flag
      const credential = await encryptKep({
        kepFileBuffer: req.file.buffer,
        kepPassword:   password,
        userId,
        clientId:      clientId || undefined,
        clientName,
        edrpou,
        fileName:      req.file.originalname,
        isActive:      false,
      })

      if (clientId) {
        await activateKep(credential.id, clientId, userId)
      } else {
        // No clientId — activate directly (first KEP, no old one to deactivate)
        await activateKep(credential.id, '', userId)
      }

      res.status(201).json({
        id:         credential.id,
        clientName: credential.clientName,
        edrpou:     credential.edrpou,
        fileName:   credential.fileName,
        createdAt:  credential.createdAt,
      })
    } catch (err) {
      console.error('[kep] upload error:', err)
      res.status(500).json({ error: 'Помилка завантаження КЕП' })
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
    console.error('[kep] list error:', err)
    res.status(500).json({ error: 'Помилка отримання списку КЕП' })
  }
})

// ---------------------------------------------------------------------------
// DELETE /api/kep/:id
// ---------------------------------------------------------------------------

router.delete('/:id', sensitiveOpRateLimit, authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params

  try {
    await deleteKep(id, res.locals.userId as string)
    res.json({ success: true })
  } catch (err) {
    console.error('[kep] delete error:', err)
    const msg = err instanceof Error ? err.message : String(err)
    const status = /not found|not owned/i.test(msg) ? 404 : 500
    res.status(status).json({ error: status === 404 ? 'КЕП не знайдено' : 'Помилка видалення КЕП' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/kep/:id/test
// ---------------------------------------------------------------------------

router.post('/:id/test', sensitiveOpRateLimit, authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { id }   = req.params
  const userId   = res.locals.userId as string

  let decrypted
  try {
    decrypted = await decryptKep(id, userId)
  } catch (err) {
    res.json({
      success: false,
      error:   err instanceof Error ? err.message : 'Не вдалось розшифрувати КЕП',
    })
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
