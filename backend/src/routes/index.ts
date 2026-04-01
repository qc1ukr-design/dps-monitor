import { Router } from 'express'
import healthRouter from './health.js'
import kmsRouter from './kms.js'
import kepRouter from './kep.js'
import { requireApiSecret } from '../middleware/auth.js'

const router = Router()

router.use('/health', healthRouter)

// KMS test endpoint — protected by X-Backend-Secret
router.use('/kms', requireApiSecret, kmsRouter)

// KEP storage and retrieval — protected by X-Backend-Secret
router.use('/kep', requireApiSecret, kepRouter)

// Future route groups are mounted here:
// router.use('/sync', requireApiSecret, syncRouter)

export default router
