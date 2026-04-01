import { Router } from 'express'
import { getSupabaseClient } from '../lib/supabase.js'

const router = Router()

/**
 * GET /health
 *
 * Liveness check — always returns 200 if the process is running.
 * Used by Railway healthcheck to determine if the container should be kept alive.
 */
router.get('/', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

/**
 * GET /health/ready
 *
 * Readiness check — verifies Supabase connectivity.
 * Call this manually to confirm env vars are correctly configured.
 */
router.get('/ready', async (_req, res) => {
  try {
    const supabase = getSupabaseClient()
    const { error } = await supabase.from('clients').select('id').limit(1)
    if (error) throw error
    res.json({ status: 'ok', supabase: 'ok', timestamp: new Date().toISOString() })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(503).json({ status: 'error', supabase: message })
  }
})

export default router
