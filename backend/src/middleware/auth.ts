import { timingSafeEqual, createHmac } from 'crypto'
import type { Request, Response, NextFunction } from 'express'

/**
 * Constant-time string comparison using HMAC-SHA256.
 *
 * P5.3: The naive pattern `a.length !== b.length || !timingSafeEqual(...)` leaks the
 * expected secret's length via timing — requests with the wrong-length header return
 * slightly faster (early exit before the comparison). HMAC digests are always 32 bytes,
 * so timingSafeEqual always runs in constant time regardless of input length.
 *
 * A zero key is used here intentionally — HMAC security properties hold for any fixed
 * key; we need timing-safe equality, not a MAC for authentication purposes.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const key   = Buffer.alloc(32, 0)
  const hmacA = createHmac('sha256', key).update(a).digest()
  const hmacB = createHmac('sha256', key).update(b).digest()
  return timingSafeEqual(hmacA, hmacB)
}

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
  if (!provided || typeof provided !== 'string' || !constantTimeEqual(provided, secret)) {
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
  const provided   = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  if (!provided || !constantTimeEqual(provided, secret)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  next()
}
