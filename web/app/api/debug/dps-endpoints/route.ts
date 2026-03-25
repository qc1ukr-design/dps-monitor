/**
 * GET /api/debug/dps-endpoints?clientId=XXX
 *
 * Tests all known DPS API endpoints for a given client with KEP auth.
 * Returns status codes + response previews to diagnose what works.
 * REMOVE THIS ROUTE BEFORE PRODUCTION LAUNCH.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import { signWithKepDecrypted, inspectKep } from '@/lib/dps/signer'

const DPS_BASE  = 'https://cabinet.tax.gov.ua/ws/public_api'
const OAUTH_URL = 'https://cabinet.tax.gov.ua/ws/auth/oauth/token'

async function probe(url: string, authHeader: string, label: string) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    })
    const text = await res.text().catch(() => '')
    return { label, status: res.status, ok: res.ok, preview: text.slice(0, 300) }
  } catch (e) {
    return { label, status: 0, ok: false, preview: String(e) }
  }
}

async function tryOAuth(label: string, body: string, headers: Record<string, string> = {}) {
  try {
    const res = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body,
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    const text = await res.text().catch(() => '')
    return { label, status: res.status, ok: res.ok, preview: text.slice(0, 400) }
  } catch (e) {
    return { label, status: 0, ok: false, preview: String(e) }
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

  const kepDecrypted = decrypt(tokenRow.kep_encrypted)
  const kepPassword = decrypt(tokenRow.kep_password_encrypted)
  const taxId = (tokenRow.kep_tax_id ?? '').trim()

  // ── KEP cert info ──────────────────────────────────────────────────────────
  let kepInfo: Record<string, string> = {}
  try {
    const pfxBuf = Buffer.from(kepDecrypted.startsWith('{')
      ? JSON.parse(kepDecrypted).files[0].base64
      : kepDecrypted, 'base64')
    const info = await inspectKep(pfxBuf, kepPassword)
    kepInfo = {
      ownerName: info.ownerName,
      taxIdInCert: info.taxId,
      validFrom: info.validFrom,
      validTo: info.validTo,
      caName: info.caName,
    }
  } catch (e) { kepInfo = { error: String(e) } }

  const year = new Date().getFullYear()

  // ── Sign taxId (for public_api Bearer) ────────────────────────────────────
  const kepAuth = await signWithKepDecrypted(kepDecrypted, kepPassword, taxId)
  const sigOfTaxId = kepAuth.startsWith('Bearer ') ? kepAuth.slice(7) : kepAuth

  // ── Sign username (for OAuth password) ────────────────────────────────────
  const username = `${taxId}-${taxId}-${Date.now()}`
  const sigOfUsername = await signWithKepDecrypted(kepDecrypted, kepPassword, username)

  // ── Standard probes ───────────────────────────────────────────────────────
  const [ppCard, splatp, zvit, corr] = await Promise.all([
    probe(`${DPS_BASE}/payer_card`, kepAuth, 'KEP → payer_card'),
    probe(`${DPS_BASE}/ta/splatp?year=${year}`, kepAuth, `KEP → ta/splatp`),
    probe(`${DPS_BASE}/zvit/zvit_list?year=${year}`, kepAuth, `KEP → zvit_list`),
    probe(`${DPS_BASE}/corr/correspondence?page=0&limit=20`, kepAuth, 'KEP → corr'),
  ])

  // ── OAuth login variants (parallel) ───────────────────────────────────────
  const sha1 = (s: string) => createHash('sha1').update(s).digest('hex').toUpperCase()
  const basic = (u: string, p: string) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64')

  const oauthResults = await Promise.all([
    // V1: no auth header, sign taxId
    tryOAuth('OAuth v1: no auth, sign taxId',
      `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(sigOfTaxId)}`),

    // V2: Basic taxId:taxId, sign taxId
    tryOAuth('OAuth v2: basic taxId:taxId, sign taxId',
      `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(sigOfTaxId)}`,
      { Authorization: basic(taxId, taxId) }),

    // V3: Basic SHA1:SHA1, sign taxId
    tryOAuth('OAuth v3: basic SHA1:SHA1, sign taxId',
      `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(sigOfTaxId)}`,
      { Authorization: basic(sha1(taxId), sha1(taxId)) }),

    // V4: client_id=cabinet in body, sign taxId
    tryOAuth('OAuth v4: client_id=cabinet, sign taxId',
      `grant_type=password&client_id=cabinet&username=${encodeURIComponent(username)}&password=${encodeURIComponent(sigOfTaxId)}`),

    // V5: client_id=ecp in body, sign taxId
    tryOAuth('OAuth v5: client_id=ecp, sign taxId',
      `grant_type=password&client_id=ecp&username=${encodeURIComponent(username)}&password=${encodeURIComponent(sigOfTaxId)}`),

    // V6: Basic taxId:taxId, sign username
    tryOAuth('OAuth v6: basic taxId:taxId, sign username',
      `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(sigOfUsername)}`,
      { Authorization: basic(taxId, taxId) }),

    // V7: no auth header, sign username
    tryOAuth('OAuth v7: no auth, sign username',
      `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(sigOfUsername)}`),

    // V8: client_id=cabinet, sign username
    tryOAuth('OAuth v8: client_id=cabinet, sign username',
      `grant_type=password&client_id=cabinet&username=${encodeURIComponent(username)}&password=${encodeURIComponent(sigOfUsername)}`),
  ])

  return NextResponse.json({
    taxId,
    kepInfo,
    standardProbes: [ppCard, splatp, zvit, corr].map(r => ({ label: r.label, status: r.status, preview: r.preview })),
    oauthVariants: oauthResults.map(r => ({ label: r.label, status: r.status, preview: r.preview })),
  })
}
