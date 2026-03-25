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
  const refreshToken = searchParams.get('refreshToken')
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

  // Test all endpoints
  const results = await Promise.all([
    // Known working
    probe(`${DPS_BASE}/payer_card`, kepAuth, 'KEP → public_api/payer_card'),
    probe(`${DPS_BASE}/ta/splatp?year=${year}`, kepAuth, `KEP → public_api/ta/splatp?year=${year}`),

    // Reports candidates (KEP auth) — year param
    probe(`${DPS_BASE}/zvit/zvit_list?year=${year}`, kepAuth, `KEP → zvit/zvit_list?year=${year}`),
    probe(`${DPS_BASE}/zvit/zvit_list?year=${year}&tin=${taxId}`, kepAuth, `KEP → zvit/zvit_list?year+tin`),
    probe(`${DPS_BASE}/zvit/zvit_list?year=${year}&edrpou=${taxId}`, kepAuth, `KEP → zvit/zvit_list?year+edrpou`),

    // Reports — date range format
    probe(`${DPS_BASE}/zvit/zvit_list?dateBegin=01.01.${year}&dateEnd=31.12.${year}`, kepAuth, `KEP → zvit/zvit_list?dateBegin/dateEnd`),
    probe(`${DPS_BASE}/zvit/zvit_list?dateBegin=01.01.${year}&dateEnd=31.12.${year}&tin=${taxId}`, kepAuth, `KEP → zvit/zvit_list?dates+tin`),

    // Reports — alternative paths
    probe(`${DPS_BASE}/zvit/zvit_list_short?dateBegin=01.01.${year}&dateEnd=31.12.${year}`, kepAuth, `KEP → zvit/zvit_list_short?dates`),
    probe(`${DPS_BASE}/zvit/zvit_list_with_quart?year=${year}`, kepAuth, `KEP → zvit/zvit_list_with_quart`),
    probe(`${DPS_BASE}/declarant/zvit_list?year=${year}`, kepAuth, `KEP → declarant/zvit_list?year`),

    // Documents — try with ws/public_api (not ws/a)
    probe(`${DPS_BASE}/corr/correspondence?page=0&limit=20`, kepAuth, 'KEP → public_api/corr/correspondence'),

    // KEP login → get OAuth tokens → test regdoc/list
    ...await (async () => {
      try {
        // signWithKepDecrypted returns "Bearer <base64>", strip prefix for OAuth password
        const bearerStr = kepAuth
        const signature = bearerStr.startsWith('Bearer ') ? bearerStr.slice(7) : bearerStr
        const idCabinet = Date.now()
        const username = `${taxId}-${taxId}-${idCabinet}`
        const loginRes = await fetch('https://cabinet.tax.gov.ua/ws/auth/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(signature)}`,
          signal: AbortSignal.timeout(20000),
          cache: 'no-store',
        })
        const loginText = await loginRes.text()
        const loginResult = { label: `KEP LOGIN → ws/auth/oauth/token (${loginRes.status})`, url: 'ws/auth/oauth/token', status: loginRes.status, ok: loginRes.ok, preview: loginText.slice(0, 300) }
        if (!loginRes.ok) return [loginResult]
        const tokens = JSON.parse(loginText)
        const freshToken = tokens.access_token
        return [
          loginResult,
          await probe(`${DPS_API}/regdoc/list?periodYear=${year}&page=0&size=15&sort=dget,desc`, `Bearer ${freshToken}`, `KEP+LOGIN → regdoc/list?periodYear=${year}`),
          await probe(`${DPS_API}/corr/correspondence?page=0&size=20`, `Bearer ${freshToken}`, 'KEP+LOGIN → corr/correspondence'),
        ]
      } catch (e) {
        return [{ label: 'KEP LOGIN → error', url: '', status: 0, ok: false, preview: String(e) }]
      }
    })(),

    // Test refresh token endpoint (pass ?refreshToken=xxx to test)
    ...(refreshToken ? await (async () => {
      const refreshUrls = [
        'https://cabinet.tax.gov.ua/ws/auth/oauth/token',
        `${DPS_API}/oauth/token`,
      ]
      const results = []
      for (const url of refreshUrls) {
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=refresh_token&refresh_token=${refreshToken}`,
            signal: AbortSignal.timeout(8000),
            cache: 'no-store',
          })
          const text = await r.text()
          results.push({ label: `REFRESH → ${url.replace('https://cabinet.tax.gov.ua', '')} (${r.status})`, url, status: r.status, ok: r.ok, preview: text.slice(0, 200) })
          // If refresh worked, test regdoc/list with fresh token
          if (r.ok) {
            try {
              const parsed = JSON.parse(text)
              if (parsed.access_token) {
                results.push(await probe(`${DPS_API}/regdoc/list?periodYear=${year}&page=0&size=15`, `Bearer ${parsed.access_token}`, `FRESH → regdoc/list`))
              }
            } catch { /* ignore */ }
            break
          }
        } catch (e) {
          results.push({ label: `REFRESH → ${url.replace('https://cabinet.tax.gov.ua', '')}`, url, status: 0, ok: false, preview: String(e) })
        }
      }
      return results
    })() : []),
  ])

  return NextResponse.json({
    taxId,
    hasUuidToken: !!uuidToken,
    results: results.map(r => ({
      label: r.label,
      status: r.status,
      ok: r.ok,
      preview: r.preview,
    })),
  })
}
