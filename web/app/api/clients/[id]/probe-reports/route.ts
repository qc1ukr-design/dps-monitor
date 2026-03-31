/**
 * GET /api/clients/[id]/probe-reports
 *
 * Debug endpoint: tests all auth methods for regdoc/list and returns
 * raw DPS responses so we can diagnose why reports aren't loading.
 * Protected — only accessible by the owning user.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import { signWithKepDecrypted, getCertOrgTaxId, diagnoseBox } from '@/lib/dps/signer'
import { loginWithKep, loginWithKepAsYuo, loginWithKepAsYuoSignEdrpou, loginWithKepStamp } from '@/lib/dps/dps-auth'

interface RouteParams { params: Promise<{ id: string }> }

const DPS_PUBLIC = 'https://cabinet.tax.gov.ua/ws/public_api'
const DPS_API    = 'https://cabinet.tax.gov.ua/ws/api'
const YEAR       = new Date().getFullYear()

async function tryFetch(url: string, headers: Record<string, string>, label: string) {
  try {
    const res = await fetch(url, {
      headers: { ...headers, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    })
    const text = await res.text()
    let body: unknown = null
    try { body = JSON.parse(text) } catch { body = text.slice(0, 500) }
    return { label, status: res.status, ok: res.ok, body }
  } catch (e) {
    return { label, status: 0, ok: false, body: String(e).slice(0, 300) }
  }
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: client } = await supabase
    .from('clients').select('id, name, edrpou').eq('id', id).single()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const { data: tokenRow } = await supabase
    .from('api_tokens')
    .select('kep_encrypted, kep_password_encrypted, kep_tax_id')
    .eq('client_id', id).eq('user_id', user.id).single()

  if (!tokenRow?.kep_encrypted)
    return NextResponse.json({ error: 'No KEP configured' }, { status: 400 })

  const kepDecrypted = decrypt(tokenRow.kep_encrypted)
  const kepPwd       = decrypt(tokenRow.kep_password_encrypted)
  const kepTaxId     = (tokenRow.kep_tax_id ?? '').trim()
  const clientEdrpou = (client.edrpou ?? '').trim()
  const isYuo        = /^\d{8}$/.test(clientEdrpou)

  const urlPub  = `${DPS_PUBLIC}/regdoc/list?periodYear=${YEAR}&page=0&size=20&sort=dget,desc`
  const urlApi  = `${DPS_API}/regdoc/list?periodYear=${YEAR}&page=0&size=20&sort=dget,desc`

  // ── Cert diagnosis ─────────────────────────────────────────────────────────
  let certDiag = ''
  let certOrgTaxId: string | null = null
  try {
    certDiag    = await diagnoseBox(kepDecrypted, kepPwd)
    certOrgTaxId = await getCertOrgTaxId(kepDecrypted, kepPwd)
  } catch (e) { certDiag = String(e) }

  const results = []

  // ── Method 0: ws/public_api signed with ЄДРПОУ from organizationIdentifier ─
  const signTaxId = certOrgTaxId ?? (isYuo ? clientEdrpou : kepTaxId)
  try {
    const auth = await signWithKepDecrypted(kepDecrypted, kepPwd, signTaxId)
    results.push(await tryFetch(urlPub, { Authorization: auth },
      `pub_api/sign(${signTaxId}) certOrgTaxId=${certOrgTaxId ?? 'none'}`))
  } catch (e) {
    results.push({ label: `pub_api/sign(${signTaxId})`, status: 0, ok: false, body: String(e) })
  }

  // ── Method 0b: ws/public_api signed with kepTaxId (РНОКПП) ───────────────
  if (isYuo && kepTaxId !== signTaxId) {
    try {
      const auth = await signWithKepDecrypted(kepDecrypted, kepPwd, kepTaxId)
      results.push(await tryFetch(urlPub, { Authorization: auth },
        `pub_api/sign(kepTaxId=${kepTaxId})`))
    } catch (e) {
      results.push({ label: `pub_api/sign(${kepTaxId})`, status: 0, ok: false, body: String(e) })
    }
  }

  // ── Method 0c: ws/public_api/regdoc/list using payer_card endpoint as baseline ─
  // (verify ws/public_api is alive with this client)
  try {
    const auth = await signWithKepDecrypted(kepDecrypted, kepPwd, signTaxId)
    results.push(await tryFetch(
      `${DPS_PUBLIC}/payer_card`,
      { Authorization: auth },
      `pub_api/payer_card(${signTaxId}) — baseline`
    ))
  } catch (e) {
    results.push({ label: 'pub_api/payer_card baseline', status: 0, ok: false, body: String(e) })
  }

  // ── Method 1: ws/api + stamp cert OAuth (ЮО only) ─────────────────────────
  if (isYuo) {
    try {
      const stampResult = await loginWithKepStamp(kepDecrypted, kepPwd)
      if (typeof stampResult === 'object') {
        results.push(await tryFetch(urlApi,
          { Authorization: `Bearer ${stampResult.accessToken}` },
          'ws_api/stamp_oauth'))
      } else {
        results.push({ label: 'ws_api/stamp_oauth', status: 0, ok: false, body: stampResult })
      }
    } catch (e) {
      results.push({ label: 'ws_api/stamp_oauth', status: 0, ok: false, body: String(e) })
    }
  }

  // ── Method 2: ws/api + {РНОКПП}-{ЄДРПОУ}-ts OAuth (ЮО only) ─────────────
  if (isYuo) {
    try {
      const r = await loginWithKepAsYuo(kepDecrypted, kepPwd, clientEdrpou)
      if (typeof r === 'object') {
        results.push(await tryFetch(urlApi,
          { Authorization: `Bearer ${r.accessToken}` },
          'ws_api/yuo_oauth'))
      } else {
        results.push({ label: 'ws_api/yuo_oauth', status: 0, ok: false, body: r })
      }
    } catch (e) {
      results.push({ label: 'ws_api/yuo_oauth', status: 0, ok: false, body: String(e) })
    }
  }

  // ── Method 3: ws/api + ФО OAuth (signs РНОКПП) ───────────────────────────
  try {
    const r = await loginWithKep(kepDecrypted, kepPwd, kepTaxId)
    results.push(await tryFetch(urlApi,
      { Authorization: `Bearer ${r.accessToken}` },
      `ws_api/fo_oauth(${kepTaxId})`))
  } catch (e) {
    results.push({ label: 'ws_api/fo_oauth', status: 0, ok: false, body: String(e) })
  }

  // ── Method 4: ws/api + ФО OAuth signing ЄДРПОУ ───────────────────────────
  if (isYuo) {
    try {
      const r = await loginWithKepAsYuoSignEdrpou(kepDecrypted, kepPwd, clientEdrpou)
      if (typeof r === 'object') {
        results.push(await tryFetch(urlApi,
          { Authorization: `Bearer ${r.accessToken}` },
          'ws_api/yuo_sign_edrpou'))
      } else {
        results.push({ label: 'ws_api/yuo_sign_edrpou', status: 0, ok: false, body: r })
      }
    } catch (e) {
      results.push({ label: 'ws_api/yuo_sign_edrpou', status: 0, ok: false, body: String(e) })
    }
  }

  return NextResponse.json({
    client: { id, name: client.name, edrpou: clientEdrpou, isYuo },
    kep: { kepTaxId, certOrgTaxId, signTaxId },
    certDiag,
    year: YEAR,
    results,
  })
}
