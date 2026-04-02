import { timingSafeEqual } from 'crypto'
import type { Request, Response, NextFunction } from 'express'

/**
 * Validates the X-Backend-Secret header against BACKEND_API_SECRET env var.
 *
 * Used on all routes that mutate data or access KEP material.
 * The secret is shared only between /web (API routes, cron) and /backend.
 */
export function requireApiSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.BACKEND_API_SECRET
  if (!secret) {
    res.status(500).json({ error: 'BACKEND_API_SECRET is not configured' })
    return
  }

  const provided = req.headers['x-backend-secret']
  if (
    !provided ||
    typeof provided !== 'string' ||
    provided.length !== secret.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
  ) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  next()
}

/**
 * Validates the Authorization: Bearer <CRON_SECRET> header.
 *
 * Used on endpoints triggered by Railway Cron or an external scheduler —
 * not called by /web, so X-Backend-Secret is not appropriate there.
 */
export function requireCronSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    res.status(500).json({ error: 'CRON_SECRET is not configured' })
    return
  }

  const authHeader = req.headers['authorization']
  const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  if (
    !provided ||
    provided.length !== secret.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
  ) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  next()
}
