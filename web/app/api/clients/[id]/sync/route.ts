/**
 * POST /api/clients/[id]/sync
 *
 * Fetches fresh data from DPS Cabinet API using the client's KEP,
 * stores results in dps_cache table.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import { signWithKep } from '@/lib/dps/signer'
import { normalizeProfile, normalizeBudget } from '@/lib/dps/normalizer'

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

  // Verify client belongs to this user
  const { data: client } = await supabase
    .from('clients')
    .select('id')
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
  let pfxBuffer: Buffer
  let password: string
  try {
    const pfxBase64 = decrypt(tokenRow.kep_encrypted)
    pfxBuffer = Buffer.from(pfxBase64, 'base64')
    password = decrypt(tokenRow.kep_password_encrypted)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to decrypt KEP', detail: String(e) }, { status: 500 })
  }

  const taxId = tokenRow.kep_tax_id?.trim() ?? ''
  if (!taxId) {
    return NextResponse.json({ error: 'KEP tax ID not stored — re-upload KEP' }, { status: 400 })
  }

  // Sign taxId
  let authHeader: string
  try {
    authHeader = await signWithKep(pfxBuffer, password, taxId)
  } catch (e) {
    return NextResponse.json({ error: 'Signing failed', detail: String(e) }, { status: 500 })
  }

  const year = new Date().getFullYear()

  // Fetch profile and budget in parallel
  const [profileResult, budgetResult] = await Promise.all([
    dpsFetch('payer_card', authHeader),
    dpsFetch(`ta/splatp?year=${year}`, authHeader),
  ])

  const now = new Date().toISOString()
  const results: Record<string, unknown> = {}

  // Upsert profile cache (normalize before storing)
  if (profileResult.ok && profileResult.body) {
    const normalized = normalizeProfile(profileResult.body)
    const { error } = await supabase
      .from('dps_cache')
      .upsert({
        client_id: id,
        user_id: user.id,
        data_type: 'profile',
        data: normalized,
        fetched_at: now,
        is_mock: false,
      }, { onConflict: 'client_id,data_type' })
    results.profile = { ok: true, error: error?.message }
  } else {
    results.profile = { ok: false, status: profileResult.status, body: profileResult.body }
  }

  // Upsert budget cache (normalize before storing)
  if (budgetResult.ok && budgetResult.body) {
    const normalized = normalizeBudget(budgetResult.body)
    const { error } = await supabase
      .from('dps_cache')
      .upsert({
        client_id: id,
        user_id: user.id,
        data_type: 'budget',
        data: normalized,
        fetched_at: now,
        is_mock: false,
      }, { onConflict: 'client_id,data_type' })
    results.budget = { ok: true, error: error?.message }
  } else {
    results.budget = { ok: false, status: budgetResult.status, body: budgetResult.body }
  }

  return NextResponse.json({ ok: true, syncedAt: now, results })
}
