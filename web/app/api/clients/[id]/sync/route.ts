/**
 * POST /api/clients/[id]/sync
 *
 * Fetches fresh data from DPS Cabinet API using the client's KEP,
 * stores results in dps_cache, detects changes and creates alerts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import { signWithKepDecrypted } from '@/lib/dps/signer'
import { normalizeProfile, normalizeBudget } from '@/lib/dps/normalizer'
import { detectAlerts } from '@/lib/dps/alerts'
import { sendAlertEmail } from '@/lib/email'

interface RouteParams {
  params: Promise<{ id: string }>
}

const DPS_BASE = 'https://cabinet.tax.gov.ua/ws/public_api'

async function dpsFetch(endpoint: string, authHeader: string) {
  const res = await fetch(`${DPS_BASE}/${endpoint}`, {
    method: 'GET',
    headers: { Authorization: authHeader, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
    cache: 'no-store',
  })
  const text = await res.text()
  let body: unknown
  try { body = JSON.parse(text) } catch { body = null }
  return { ok: res.ok, status: res.status, body }
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify client belongs to this user (fetch name for alerts)
  const { data: client } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // Load token row
  const { data: tokenRow } = await supabase
    .from('api_tokens')
    .select('kep_encrypted, kep_password_encrypted, kep_tax_id')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .single()

  if (!tokenRow?.kep_encrypted || !tokenRow?.kep_password_encrypted) {
    return NextResponse.json({ error: 'KEP not configured for this client' }, { status: 400 })
  }

  // Decrypt KEP
  let kepDecrypted: string
  let password: string
  try {
    kepDecrypted = decrypt(tokenRow.kep_encrypted)
    password = decrypt(tokenRow.kep_password_encrypted)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to decrypt KEP', detail: String(e) }, { status: 500 })
  }

  const taxId = tokenRow.kep_tax_id?.trim() ?? ''
  if (!taxId) {
    return NextResponse.json({ error: 'KEP tax ID not stored — re-upload KEP' }, { status: 400 })
  }

  // Sign
  let authHeader: string
  try {
    authHeader = await signWithKepDecrypted(kepDecrypted, password, taxId)
  } catch (e) {
    return NextResponse.json({ error: 'Signing failed', detail: String(e) }, { status: 500 })
  }

  // Read OLD normalized cache BEFORE overwriting (for alert diff)
  const { data: oldCache } = await supabase
    .from('dps_cache')
    .select('data_type, data')
    .eq('client_id', id)
    .in('data_type', ['profile', 'budget'])

  const oldProfile = oldCache?.find(r => r.data_type === 'profile')?.data ?? null
  const oldBudget  = oldCache?.find(r => r.data_type === 'budget')?.data  ?? null

  const year = new Date().getFullYear()

  // Fetch profile and budget in parallel
  const [profileResult, budgetResult] = await Promise.all([
    dpsFetch('payer_card', authHeader),
    dpsFetch(`ta/splatp?year=${year}`, authHeader),
  ])

  const now = new Date().toISOString()
  const results: Record<string, unknown> = {}
  let newProfile: unknown = null
  let newBudget:  unknown = null

  // Upsert profile cache
  if (profileResult.ok && profileResult.body) {
    newProfile = normalizeProfile(profileResult.body)
    const [{ error }, { error: rawError }] = await Promise.all([
      supabase.from('dps_cache').upsert({
        client_id: id,
        user_id: user.id,
        data_type: 'profile',
        data: newProfile,
        fetched_at: now,
        is_mock: false,
      }, { onConflict: 'client_id,data_type' }),
      supabase.from('dps_cache').upsert({
        client_id: id,
        user_id: user.id,
        data_type: 'profile_raw',
        data: profileResult.body,
        fetched_at: now,
        is_mock: false,
      }, { onConflict: 'client_id,data_type' }),
    ])
    results.profile = { ok: true, error: error?.message ?? rawError?.message }
  } else {
    results.profile = { ok: false, status: profileResult.status, body: profileResult.body }
  }

  // Upsert budget cache
  if (budgetResult.ok && budgetResult.body) {
    newBudget = normalizeBudget(budgetResult.body)
    const { error } = await supabase
      .from('dps_cache')
      .upsert({
        client_id: id,
        user_id: user.id,
        data_type: 'budget',
        data: newBudget,
        fetched_at: now,
        is_mock: false,
      }, { onConflict: 'client_id,data_type' })
    results.budget = { ok: true, error: error?.message }
  } else {
    results.budget = { ok: false, status: budgetResult.status, body: budgetResult.body }
  }

  // ── Alert detection (only when we have prior data to compare) ─────────────
  let alertsCreated = 0
  if ((oldProfile || oldBudget) && (newProfile || newBudget)) {
    const detected = detectAlerts(oldProfile, newProfile, oldBudget, newBudget, client.name)
    if (detected.length > 0) {
      await supabase.from('alerts').insert(
        detected.map(a => ({
          user_id: user.id,
          client_id: id,
          type: a.type,
          message: a.message,
          data: a.data ?? null,
          is_read: false,
        }))
      )
      alertsCreated = detected.length

      // Email notification (fire-and-forget, never blocks the response)
      try {
        const emailAddr = user.email
        if (emailAddr) {
          sendAlertEmail({
            to: emailAddr,
            clientName: client.name,
            alerts: detected.map(a => ({ message: a.message })),
          }).catch(() => { /* ignore email errors */ })
        }
      } catch { /* ignore */ }
    }
  }

  return NextResponse.json({ ok: true, syncedAt: now, results, alertsCreated })
}
