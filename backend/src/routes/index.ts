import { Router } from 'express'
import healthRouter from './health.js'
import kmsRouter from './kms.js'
import kepRouter from './kep.js'
import kepCredentialsRouter from './kepCredentials.js'
import { requireApiSecret } from '../middleware/auth.js'

const router = Router()

router.use('/health', healthRouter)

// KMS test endpoint — protected by X-Backend-Secret
router.use('/kms', requireApiSecret, kmsRouter)

// KEP storage (legacy — api_tokens table, auto-detect KMS/AES) — protected by X-Backend-Secret
router.use('/kep', requireApiSecret, kepRouter)

// KEP storage v2 (kep_credentials table, per-KEP DEK, audit log) — protected by X-Backend-Secret
router.use('/kep-credentials', requireApiSecret, kepCredentialsRouter)

export default router
