/**
 * GET /api/cron/sync-all
 *
 * Called by Vercel Cron (see vercel.json).
 * Syncs DPS data for ALL clients with KEP configured,
 * then detects changes and writes alerts.
 *
 * Protected by CRON_SECRET env var.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decrypt } from '@/lib/crypto'
import { signWithKepDecrypted } from '@/lib/dps/signer'
import { normalizeProfile, normalizeBudget } from '@/lib/dps/normalizer'
import { detectAlerts } from '@/lib/dps/alerts'
import { sendAlertEmail } from '@/lib/email'

const DPS_BASE = 'https://cabinet.tax.gov.ua/ws/public_api'

async function dpsFetch(endpoint: string, authHeader: string) {
  const res = await fetch(`${DPS_BASE}/${endpoint}`, {
    method: 'GET',
    headers: { Authorization: authHeader, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  })
  const text = await res.text()
  let body: unknown
  try { body = JSON.parse(text) } catch { body = null }
  return { ok: res.ok, status: res.status, body }
}

export async function GET(request: NextRequest) {
  // ── Auth: verify Vercel cron secret ──────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  let synced = 0
  let errors = 0
  let alertsCreated = 0
  const clientResults: Record<string, unknown> = {}

  // ── Fetch all tokens with KEP ─────────────────────────────────────────────
  const { data: tokens, error: tokensError } = await supabase
    .from('api_tokens')
    .select('client_id, user_id, kep_encrypted, kep_password_encrypted, kep_tax_id')
    .not('kep_encrypted', 'is', null)
    .not('kep_password_encrypted', 'is', null)

  if (tokensError) {
    return NextResponse.json({ error: tokensError.message }, { status: 500 })
  }
  if (!tokens?.length) {
    return NextResponse.json({ ok: true, message: 'No clients with KEP', synced: 0 })
  }

  // ── Client name lookup ────────────────────────────────────────────────────
  const clientIds = tokens.map(t => t.client_id)
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')
    .in('id', clientIds)
  const clientMap = new Map(clients?.map(c => [c.id, c.name]) ?? [])

  // ── User email lookup (for notifications) ────────────────────────────────
  const uniqueUserIds = Array.from(new Set(tokens.map(t => t.user_id)))
  const userEmailMap = new Map<string, string>()
  for (const uid of uniqueUserIds) {
    try {
      const { data: { user } } = await supabase.auth.admin.getUserById(uid)
      if (user?.email) userEmailMap.set(uid, user.email)
    } catch { /* skip */ }
  }

  // ── Process each client ───────────────────────────────────────────────────
  for (const token of tokens) {
    const { client_id: clientId, user_id: userId } = token
    const clientName = clientMap.get(clientId) ?? clientId

    try {
      // Decrypt KEP
      const kepDecrypted = decrypt(token.kep_encrypted)
      const password = decrypt(token.kep_password_encrypted)
      const taxId = token.kep_tax_id?.trim() ?? ''
      if (!taxId) { errors++; continue }

      // Sign
      const auth = await signWithKepDecrypted(kepDecrypted, password, taxId)

      // Read OLD normalized data before overwriting
      const { data: oldCache } = await supabase
        .from('dps_cache')
        .select('data_type, data')
        .eq('client_id', clientId)
        .in('data_type', ['profile', 'budget'])

      const oldProfile = oldCache?.find(r => r.data_type === 'profile')?.data ?? null
      const oldBudget = oldCache?.find(r => r.data_type === 'budget')?.data ?? null

      // Fetch fresh data from DPS
      const year = new Date().getFullYear()
      const [profileResult, budgetResult] = await Promise.all([
        dpsFetch('payer_card', auth),
        dpsFetch(`ta/splatp?year=${year}`, auth),
      ])

      const now = new Date().toISOString()
      let newProfile: unknown = null
      let newBudget: unknown = null

      if (profileResult.ok && profileResult.body) {
        newProfile = normalizeProfile(profileResult.body)
        await supabase.from('dps_cache').upsert({
          client_id: clientId, user_id: userId,
          data_type: 'profile', data: newProfile,
          fetched_at: now, is_mock: false,
        }, { onConflict: 'client_id,data_type' })
      }

      if (budgetResult.ok && budgetResult.body) {
        newBudget = normalizeBudget(budgetResult.body)
        await supabase.from('dps_cache').upsert({
          client_id: clientId, user_id: userId,
          data_type: 'budget', data: newBudget,
          fetched_at: now, is_mock: false,
        }, { onConflict: 'client_id,data_type' })
      }

      // Detect alerts (only when we have prior data to compare with)
      let clientAlerts = 0
      if ((oldProfile || oldBudget) && (newProfile || newBudget)) {
        const detected = detectAlerts(oldProfile, newProfile, oldBudget, newBudget, clientName)
        if (detected.length > 0) {
          await supabase.from('alerts').insert(
            detected.map(a => ({
              user_id: userId,
              client_id: clientId,
              type: a.type,
              message: a.message,
              data: a.data ?? null,
              is_read: false,
            }))
          )
          clientAlerts = detected.length
          alertsCreated += clientAlerts

          // Email notification (fire-and-forget)
          const emailAddr = userEmailMap.get(userId)
          if (emailAddr) {
            sendAlertEmail({
              to: emailAddr,
              clientName,
              alerts: detected.map(a => ({ message: a.message })),
            }).catch(() => { /* ignore */ })
          }
        }
      }

      clientResults[clientId] = { ok: true, alerts: clientAlerts }
      synced++
    } catch (e) {
      clientResults[clientId] = { ok: false, error: String(e) }
      errors++
    }
  }

  return NextResponse.json({
    ok: true,
    synced,
    errors,
    alertsCreated,
    results: clientResults,
  })
}
