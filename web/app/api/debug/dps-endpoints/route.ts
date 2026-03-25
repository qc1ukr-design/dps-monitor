/**
 * GET /api/debug/dps-endpoints?clientId=XXX
 *
 * Tests all known DPS API endpoints for a given client with KEP auth.
 * Returns status codes + response previews to diagnose what works.
 * REMOVE THIS ROUTE BEFORE PRODUCTION LAUNCH.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import { signWithKepDecrypted } from '@/lib/dps/signer'

const DPS_BASE = 'https://cabinet.tax.gov.ua/ws/public_api'
const DPS_A    = 'https://cabinet.tax.gov.ua/ws/a'
const DPS_API  = 'https://cabinet.tax.gov.ua/ws/api'

async function probe(url: string, authHeader: string, label: string) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    })
    const text = await res.text().catch(() => '')
    const preview = text.slice(0, 300)
    return { label, url, status: res.status, ok: res.ok, preview }
  } catch (e) {
    return { label, url, status: 0, ok: false, preview: String(e) }
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: tokenRow } = await supabase
    .from('api_tokens')
    .select('kep_encrypted, kep_password_encrypted, kep_tax_id, token_encrypted')
    .eq('client_id', clientId)
    .eq('user_id', user.id)
    .single()

  if (!tokenRow?.kep_encrypted) {
    return NextResponse.json({ error: 'No KEP configured for this client' }, { status: 404 })
  }

  // Build KEP auth header
  const kepDecrypted = decrypt(tokenRow.kep_encrypted)
  const password = decrypt(tokenRow.kep_password_encrypted)
  const taxId = (tokenRow.kep_tax_id ?? '').trim()
  const kepAuth = await signWithKepDecrypted(kepDecrypted, password, taxId)

  // UUID token (if available)
  let uuidToken: string | null = null
  if (tokenRow.token_encrypted) {
    try { uuidToken = decrypt(tokenRow.token_encrypted).trim() } catch { /* ignore */ }
  }

  const year = new Date().getFullYear()

  // Standard endpoint probes (parallel)
  const results = await Promise.all([
    probe(`${DPS_BASE}/payer_card`, kepAuth, 'KEP → public_api/payer_card'),
    probe(`${DPS_BASE}/ta/splatp?year=${year}`, kepAuth, `KEP → public_api/ta/splatp?year=${year}`),
    probe(`${DPS_BASE}/zvit/zvit_list?year=${year}`, kepAuth, `KEP → zvit/zvit_list?year=${year}`),
    probe(`${DPS_BASE}/corr/correspondence?page=0&limit=20`, kepAuth, 'KEP → public_api/corr/correspondence'),
  ])

  // KEP OAuth login → get session token → test private API
  const signature = kepAuth.startsWith('Bearer ') ? kepAuth.slice(7) : kepAuth
  const username = `${taxId}-${taxId}-${Date.now()}`
  let loginResult: { label: string; url: string; status: number; ok: boolean; preview: string }
  let loginToken: string | null = null
  try {
    const loginRes = await fetch('https://cabinet.tax.gov.ua/ws/auth/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(signature)}`,
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    const loginText = await loginRes.text()
    loginResult = { label: `KEP LOGIN (${loginRes.status})`, url: 'ws/auth/oauth/token', status: loginRes.status, ok: loginRes.ok, preview: loginText.slice(0, 300) }
    if (loginRes.ok) {
      const tokens = JSON.parse(loginText)
      loginToken = tokens.access_token ?? null
    }
  } catch (e) {
    loginResult = { label: 'KEP LOGIN → error', url: 'ws/auth/oauth/token', status: 0, ok: false, preview: String(e) }
  }

  const loginProbes = loginToken ? await Promise.all([
    probe(`${DPS_API}/regdoc/list?periodYear=${year}&page=0&size=15&sort=dget,desc`, `Bearer ${loginToken}`, `SESSION → regdoc/list`),
    probe(`${DPS_API}/corr/correspondence?page=0&size=20`, `Bearer ${loginToken}`, 'SESSION → corr/correspondence'),
    probe(`${DPS_API}/regdoc/list?periodYear=${year}&page=0&size=15&sort=dget,desc`, `Bearer ${loginToken}`, `SESSION → ws/a/regdoc/list`).then(
      () => probe(`${DPS_A}/regdoc/list?periodYear=${year}&page=0&size=15&sort=dget,desc`, `Bearer ${loginToken!}`, `SESSION/a → regdoc/list`)
    ),
  ]) : []

  const allResults = [...results, loginResult, ...loginProbes]

  return NextResponse.json({
    taxId,
    hasUuidToken: !!uuidToken,
    results: allResults.map(r => ({
      label: r.label,
      status: r.status,
      ok: r.ok,
      preview: r.preview,
    })),
  })
}
// force redeploy Wed Mar 25 15:01:44     2026
