import { Router } from 'express'
import { getSupabaseClient } from '../lib/supabase.js'

const router = Router()

/**
 * GET /health
 *
 * Liveness + readiness check used by Railway and the load balancer.
 * Verifies that Supabase is reachable. Does NOT check KMS (too slow/costly).
 */
router.get('/', async (_req, res) => {
  try {
    const supabase = getSupabaseClient()
    // Lightweight query — just confirm the connection works
    const { error } = await supabase.from('clients').select('id').limit(1)
    if (error) throw error

    res.json({ status: 'ok', supabase: 'ok', timestamp: new Date().toISOString() })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(503).json({ status: 'error', supabase: message })
  }
})

export default router
