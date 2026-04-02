import type { Request, Response, NextFunction } from 'express'

export interface AppError extends Error {
  statusCode?: number
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = err.statusCode ?? 500

  // Log full details server-side (Railway logs) — never expose internals to the client
  console.error(`[error] ${status} — ${err.message}`, err.stack)

  // Return a generic message to the client — no stack traces, no internal details.
  // Route handlers already send explicit safe 4xx messages; anything reaching
  // this handler must never expose err.message (may contain DB schema / AWS ARNs).
  const clientMessage = status < 500 ? 'Bad request' : 'Internal server error'

  res.status(status).json({ error: clientMessage })
}
