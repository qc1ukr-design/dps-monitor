/**
 * GET /api/clients/[id]/probe-docs
 * Temporary endpoint to discover DPS correspondence API endpoints.
 * Uses KEP signing (same as sync route).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import { signWithKepDecrypted } from '@/lib/dps/signer'

interface RouteParams {
  params: Promise<{ id: string }>
}

const DPS_BASE = 'https://cabinet.tax.gov.ua/ws/public_api'

async function tryEndpoint(endpoint: string, authHeader: string) {
  try {
    const res = await fetch(`${DPS_BASE}/${endpoint}`, {
      method: 'GET',
      headers: { Authorization: authHeader, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    })
    const text = await res.text()
    let body: unknown
    try { body = JSON.parse(text) } catch { body = text.substring(0, 300) }
    return { status: res.status, ok: res.ok, bodyPreview: JSON.stringify(body).substring(0, 500) }
  } catch (e) {
    return { error: String(e) }
  }
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: tokenRow } = await supabase
    .from('api_tokens')
    .select('kep_encrypted, kep_password_encrypted, kep_tax_id')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .single()

  if (!tokenRow?.kep_encrypted) return NextResponse.json({ error: 'KEP not configured' }, { status: 400 })

  const kepDecrypted = decrypt(tokenRow.kep_encrypted)
  const password = decrypt(tokenRow.kep_password_encrypted)
  const taxId = tokenRow.kep_tax_id?.trim() ?? ''
  const authHeader = await signWithKepDecrypted(kepDecrypted, password, taxId)

  const rnocpp = taxId

  // Try GET candidates
  const getCandidates = [
    `corr/correspondence?rnocpp=${rnocpp}&page=0&limit=10`,
    `corr/correspondence?tin=${rnocpp}&page=0&limit=10`,
    `corr/correspondence?dateFrom=2025-01-01&dateTo=2026-12-31`,
    `payer/corr?rnocpp=${rnocpp}`,
    `payer/messages?rnocpp=${rnocpp}`,
    `inbox?rnocpp=${rnocpp}`,
  ]

  // Try POST candidates
  async function tryPost(endpoint: string, body: Record<string, unknown>) {
    try {
      const res = await fetch(`${DPS_BASE}/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: authHeader, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      })
      const text = await res.text()
      let body2: unknown
      try { body2 = JSON.parse(text) } catch { body2 = text.substring(0, 200) }
      return { status: res.status, ok: res.ok, bodyPreview: JSON.stringify(body2).substring(0, 300) }
    } catch (e) {
      return { error: String(e) }
    }
  }

  const results: Record<string, unknown> = {}
  for (const ep of getCandidates) {
    results['GET:' + ep] = await tryEndpoint(ep, authHeader)
  }
  results['POST:corr/correspondence'] = await tryPost('corr/correspondence', { rnocpp, page: 0, limit: 10 })
  results['POST:corr/correspondence(tin)'] = await tryPost('corr/correspondence', { tin: rnocpp, page: 0, limit: 10 })
  results['POST:inbox'] = await tryPost('inbox', { rnocpp })

  return NextResponse.json(results)
}
