/**
 * POST /api/dps/test-sign
 *
 * Test endpoint: sign РНОКПП with KEP and call DPS ws/public_api/payer_card.
 * Accepts the .pfx file as a base64 string in the request body.
 * Used to validate the signing approach before storing KEP in the DB.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { signWithKep, inspectKep } from '@/lib/dps/signer'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    pfxBase64: string
    password: string
    taxId?: string   // РНОКПП або ЄДРПОУ — якщо не вказано, береться з сертифіката
  }

  const { pfxBase64, password, taxId: explicitTaxId } = body

  if (!pfxBase64 || !password) {
    return NextResponse.json({ error: 'pfxBase64 and password are required' }, { status: 400 })
  }

  let pfxBuffer: Buffer
  try {
    pfxBuffer = Buffer.from(pfxBase64, 'base64')
  } catch {
    return NextResponse.json({ error: 'Invalid pfxBase64' }, { status: 400 })
  }

  // 1. Inspect the certificate
  let kepInfo
  try {
    kepInfo = await inspectKep(pfxBuffer, password)
  } catch (e) {
    return NextResponse.json({
      error: 'Failed to load KEP',
      detail: String(e),
    }, { status: 400 })
  }

  const taxId = (explicitTaxId ?? kepInfo.taxId).trim()
  if (!taxId) {
    return NextResponse.json({
      error: 'Could not determine taxId. Pass it explicitly as taxId field.',
      kepInfo,
    }, { status: 400 })
  }

  // 2. Sign the taxId string with DSTU 4145
  let authHeader: string
  try {
    authHeader = await signWithKep(pfxBuffer, password, taxId)
  } catch (e) {
    return NextResponse.json({
      error: 'Signing failed',
      detail: String(e),
      kepInfo,
    }, { status: 500 })
  }

  // 3. Call DPS API payer_card
  const payerCardUrl = 'https://cabinet.tax.gov.ua/ws/public_api/payer_card'
  let dpsResult
  try {
    const res = await fetch(payerCardUrl, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    })
    const text = await res.text()
    let body: unknown
    try { body = JSON.parse(text) } catch { body = text.substring(0, 500) }
    dpsResult = { status: res.status, ok: res.ok, body }
  } catch (e) {
    dpsResult = { error: String(e) }
  }

  return NextResponse.json({
    kepInfo,
    taxIdUsed: taxId,
    authHeaderLength: authHeader.length,
    authHeaderPreview: authHeader.substring(0, 40) + '...',
    dps: dpsResult,
  })
}
