import { Router } from 'express'
import healthRouter from './health.js'
import kmsRouter from './kms.js'
import kepRouter from './kep.js'
import kepCredentialsRouter from './kepCredentials.js'
import kepRoutesRouter from './kepRoutes.js'
import { requireApiSecret } from '../middleware/auth.js'

const router = Router()

router.use('/health', healthRouter)

// KMS test endpoint — protected by X-Backend-Secret
router.use('/kms', requireApiSecret, kmsRouter)

// KEP storage (legacy — api_tokens table, auto-detect KMS/AES) — protected by X-Backend-Secret
router.use('/kep', requireApiSecret, kepRouter)

// KEP storage v2 (kep_credentials table, per-KEP DEK, audit log) — protected by X-Backend-Secret
router.use('/kep-credentials', requireApiSecret, kepCredentialsRouter)

// KEP public REST API — protected by Supabase JWT (user-facing: browser / mobile)
//
// Intentional design: X-Backend-Secret is NOT required here.
// Rationale: this endpoint is consumed directly by the browser/mobile app (not via the
// Next.js web layer), so the shared backend secret would need to be embedded in a
// client-side bundle — which would make it meaningless. Supabase JWT (verified server-side
// via getUser()) provides user-level authentication instead.
//
// Threat model acknowledgement:
//   - KMS quota abuse / cost amplification: mitigated by uploadRateLimit (10/hr/IP) and
//     sensitiveOpRateLimit (20/hr/IP) defined in kepRoutes.ts.
//   - Unauthenticated access: every route in kepRoutesRouter requires a valid Supabase JWT.
//   - CORS: only Vercel origin is allowed (configured in Express CORS middleware).
//
// If this endpoint is ever moved to server-only consumption, add requireApiSecret here.
router.use('/api/kep', kepRoutesRouter)

export default router
