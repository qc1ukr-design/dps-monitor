/**
 * GET /api/clients/[id]/reports
 *
 * Returns tax reports for a client from DPS for the current year.
 * Auth via Authorization: Bearer header (mobile app).
 * KEP decryption delegated to backend (handles both KMS and legacy AES).
 */
import { NextRequest, NextResponse } from 'next/server'
import { mobileAuth } from '@/lib/supabase/mobile'
import { backendGetKepCredentialByClient } from '@/lib/backend'
import { signWithKepDecrypted, getCertOrgTaxId } from '@/lib/dps/signer'
import {
  loginWithKep,
  loginWithKepAsYuo,
  loginWithKepAsYuoSignEdrpou,
  loginWithKepStamp,
} from '@/lib/dps/dps-auth'
import { normalizeReports } from '@/lib/dps/normalizer'
import { decrypt } from '@/lib/crypto'

interface RouteParams {
  params: Promise<{ id: string }>
}

const DPS_PUBLIC = 'https://cabinet.tax.gov.ua/ws/public_api'
const DPS_API    = 'https://cabinet.tax.gov.ua/ws/api'
const DPS_A      = 'https://cabinet.tax.gov.ua/ws/a'
const YEAR       = new Date().getFullYear()

function isAllFoForms(reports: { formCode: string }[]): boolean {
  return reports.length > 0 && reports.every(r => r.formCode.toUpperCase().startsWith('F'))
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const { supabase, user } = await mobileAuth(request)
  if (!supabase || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Extract Bearer token for backend KEP decryption
  const authHeader = request.headers.get('authorization') ?? ''
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  const { data: client } = await supabase
    .from('clients')
    .select('id, edrpou')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Get token metadata — kep_tax_id for ФО auth, token_encrypted for UUID-token
  const { data: tokenRow } = await supabase
    .from('api_tokens')
    .select('kep_tax_id, token_encrypted')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  const hasUuid = !!tokenRow?.token_encrypted

  // Try to get decrypted KEP via backend (handles kep_credentials + KMS)
  let kepDecrypted: string | null = null
  let kepPwd: string | null = null
  if (accessToken) {
    try {
      const kep = await backendGetKepCredentialByClient(id, accessToken)
      kepDecrypted = kep.kepData
      kepPwd = kep.password
    } catch { /* no KEP in kep_credentials */ }
  }

  const hasKep = !!(kepDecrypted && kepPwd)

  if (!hasKep && !hasUuid) {
    return NextResponse.json({ reports: [], total: 0, hasToken: false })
  }

  const clientEdrpou = (client.edrpou ?? '').trim()
  const isYuo        = /^\d{8}$/.test(clientEdrpou)
  const opts         = { Accept: 'application/json' }

  const urlApi = `${DPS_API}/regdoc/list?periodYear=${YEAR}&page=0&size=100&sort=dget,desc`
  const urlPub = `${DPS_PUBLIC}/reg_doc/list?periodYear=${YEAR}`
  const urlA   = `${DPS_A}/regdoc/list?periodYear=${YEAR}&page=0&size=100&sort=dget,desc`

  if (hasKep) {
    const kepTaxId = (tokenRow?.kep_tax_id ?? '').trim()

    // 0. ws/public_api with raw KEP signature
    try {
      const certOrgTaxId = await getCertOrgTaxId(kepDecrypted!, kepPwd!)
      const signTaxId    = certOrgTaxId ?? (isYuo ? clientEdrpou : kepTaxId)
      const dpsAuthHeader = await signWithKepDecrypted(kepDecrypted!, kepPwd!, signTaxId)
      const res = await fetch(urlPub, {
        headers: { Authorization: dpsAuthHeader, ...opts },
        signal: AbortSignal.timeout(12000), cache: 'no-store',
      })
      if (res.ok) {
        const result = normalizeReports(await res.json())
        if (!(isYuo && isAllFoForms(result.reports))) {
          return NextResponse.json({ ...result, hasToken: true })
        }
      }
    } catch { /* continue */ }

    // 1. stamp cert OAuth (ЮО only)
    if (isYuo) {
      try {
        const r = await loginWithKepStamp(kepDecrypted!, kepPwd!)
        if (typeof r === 'object') {
          const res = await fetch(urlApi, {
            headers: { Authorization: `Bearer ${r.accessToken}`, ...opts },
            signal: AbortSignal.timeout(12000), cache: 'no-store',
          })
          if (res.ok) return NextResponse.json({ ...normalizeReports(await res.json()), hasToken: true })
        }
      } catch { /* continue */ }
    }

    // 2. OAuth {РНОКПП}-{ЄДРПОУ}-ts (ЮО only)
    if (isYuo) {
      try {
        const r = await loginWithKepAsYuo(kepDecrypted!, kepPwd!, clientEdrpou)
        if (typeof r === 'object') {
          const res = await fetch(urlApi, {
            headers: { Authorization: `Bearer ${r.accessToken}`, ...opts },
            signal: AbortSignal.timeout(12000), cache: 'no-store',
          })
          if (res.ok) return NextResponse.json({ ...normalizeReports(await res.json()), hasToken: true })
        }
      } catch { /* continue */ }
    }

    // 3. OAuth sign ЄДРПОУ (ЮО only)
    if (isYuo) {
      try {
        const r = await loginWithKepAsYuoSignEdrpou(kepDecrypted!, kepPwd!, clientEdrpou)
        if (typeof r === 'object') {
          const res = await fetch(urlApi, {
            headers: { Authorization: `Bearer ${r.accessToken}`, ...opts },
            signal: AbortSignal.timeout(12000), cache: 'no-store',
          })
          if (res.ok) return NextResponse.json({ ...normalizeReports(await res.json()), hasToken: true })
        }
      } catch { /* continue */ }
    }

    // 4. ФО OAuth (ФО/ФОП only)
    if (!isYuo && kepTaxId) {
      try {
        const { accessToken: dpsToken } = await loginWithKep(kepDecrypted!, kepPwd!, kepTaxId)
        const res = await fetch(urlApi, {
          headers: { Authorization: `Bearer ${dpsToken}`, ...opts },
          signal: AbortSignal.timeout(12000), cache: 'no-store',
        })
        if (res.ok) return NextResponse.json({ ...normalizeReports(await res.json()), hasToken: true })
      } catch { /* continue */ }
    }
  }

  if (hasUuid) {
    try {
      const res = await fetch(urlA, {
        headers: { Authorization: `Bearer ${decrypt(tokenRow!.token_encrypted!).trim()}`, ...opts },
        signal: AbortSignal.timeout(15000), cache: 'no-store',
      })
      if (res.ok) return NextResponse.json({ ...normalizeReports(await res.json()), hasToken: true })
    } catch { /* continue */ }
  }

  return NextResponse.json({ reports: [], total: 0, hasToken: true, noAccess: true })
}
