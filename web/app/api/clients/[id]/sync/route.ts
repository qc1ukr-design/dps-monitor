/**
 * POST /api/clients/[id]/sync
 *
 * Fetches fresh data from DPS Cabinet API using the client's KEP,
 * stores results in dps_cache, detects changes and creates alerts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { backendGetKep } from '@/lib/backend'
import { signWithKepDecrypted, getCertOrgTaxId, getCertValidTo } from '@/lib/dps/signer'
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

  // Verify client belongs to this user (fetch name + edrpou for alerts + ЮО auth)
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, edrpou')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // Load token metadata (tax ID + validity — no encrypted fields needed)
  const { data: tokenRow } = await supabase
    .from('api_tokens')
    .select('kep_tax_id, kep_valid_to')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .not('kep_encrypted', 'is', null)
    .single()

  if (!tokenRow) {
    return NextResponse.json({ error: 'KEP not configured for this client' }, { status: 400 })
  }

  // Fetch and decrypt KEP via backend (supports KMS envelope + legacy AES)
  let kepDecrypted: string
  let password: string
  try {
    const kep = await backendGetKep(id, user.id)
    kepDecrypted = kep.kepData
    password = kep.password
  } catch (e) {
    return NextResponse.json({ error: 'Failed to decrypt KEP', detail: String(e) }, { status: 500 })
  }

  const kepTaxId = tokenRow.kep_tax_id?.trim() ?? ''
  if (!kepTaxId) {
    return NextResponse.json({ error: 'KEP tax ID not stored — re-upload KEP' }, { status: 400 })
  }

  // For ЮО (legal entity): clients.edrpou is the 8-digit ЄДРПОУ.
  // The director's personal cert has РНОКПП (10 digits) as kep_tax_id,
  // but DPS requires signing the organisation's ЄДРПОУ with the director's key.
  // For ФОП / physical persons, edrpou equals the РНОКПП (or is absent) → use kep_tax_id.
  let edrpou = client.edrpou?.trim() ?? ''

  // ── Self-heal: fix clients.edrpou if it was wrongly stored as РНОКПП (10 digits) ──
  // Happens when a ЮО director KEP was uploaded as a single file via the old from-kep
  // code which used kepInfo.taxId (РНОКПП) instead of kepInfo.orgTaxId (ЄДРПОУ).
  // We detect this case and fix it transparently so the next sync already uses ЄДРПОУ.
  if (/^\d{10}$/.test(edrpou)) {
    try {
      const orgTaxId = await getCertOrgTaxId(kepDecrypted, password)
      if (orgTaxId) {
        await supabase.from('clients').update({ edrpou: orgTaxId }).eq('id', id)
        console.log(`[sync] self-healed edrpou for client=${id}: ${edrpou} → ${orgTaxId}`)
        edrpou = orgTaxId
      }
    } catch (e) {
      console.warn(`[sync] getCertOrgTaxId failed for client=${id}:`, e)
    }
  }

  const taxId = (edrpou && /^\d{8}$/.test(edrpou)) ? edrpou : kepTaxId

  // ── Backfill kep_valid_to if missing (old clients saved before the cert.valid.to fix) ──
  if (!tokenRow.kep_valid_to) {
    try {
      const validTo = await getCertValidTo(kepDecrypted, password)
      if (validTo) {
        await supabase.from('api_tokens').update({ kep_valid_to: validTo }).eq('client_id', id).eq('user_id', user.id)
        console.log(`[sync] backfilled kep_valid_to for client=${id}: ${validTo}`)
      }
    } catch (e) {
      console.warn(`[sync] getCertValidTo failed for client=${id}:`, e)
    }
  }

  console.log(`[sync] client=${id} kepTaxId=${kepTaxId} edrpou=${edrpou} → signing with=${taxId}`)

  // Sign
  let authHeader: string
  try {
    authHeader = await signWithKepDecrypted(kepDecrypted, password, taxId)
    console.log(`[sync] client=${id} signing OK`)
  } catch (e) {
    console.error(`[sync] client=${id} signing FAILED:`, e)
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

  console.log(`[sync] client=${id} profile=${profileResult.status} budget=${budgetResult.status}`)

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
    results.profile = { ok: true, dbError: error?.message ?? rawError?.message ?? null }
  } else {
    // DPS returned an error — include truncated body for diagnosis
    const bodyPreview = profileResult.body
      ? JSON.stringify(profileResult.body).slice(0, 300)
      : null
    results.profile = { ok: false, status: profileResult.status, body: bodyPreview }
    console.error(`[sync] client=${id} profile DPS error ${profileResult.status}:`, bodyPreview)
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
    results.budget = { ok: true, dbError: error?.message ?? null }
  } else {
    const bodyPreview = budgetResult.body
      ? JSON.stringify(budgetResult.body).slice(0, 300)
      : null
    results.budget = { ok: false, status: budgetResult.status, body: bodyPreview }
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
