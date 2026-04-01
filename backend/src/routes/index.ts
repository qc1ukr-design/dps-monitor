import { Router } from 'express'
import healthRouter from './health.js'

const router = Router()

router.use('/health', healthRouter)

// Future route groups are mounted here:
// router.use('/kep', requireApiSecret, kepRouter)
// router.use('/sync', requireApiSecret, syncRouter)

export default router
