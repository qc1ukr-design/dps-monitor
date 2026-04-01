import { Router } from 'express'
import healthRouter from './health.js'
import kmsRouter from './kms.js'
import { requireApiSecret } from '../middleware/auth.js'

const router = Router()

router.use('/health', healthRouter)

// KMS test endpoint — protected by X-Backend-Secret, safe to keep in production
router.use('/kms', requireApiSecret, kmsRouter)

// Future route groups are mounted here:
// router.use('/kep', requireApiSecret, kepRouter)
// router.use('/sync', requireApiSecret, syncRouter)

export default router
