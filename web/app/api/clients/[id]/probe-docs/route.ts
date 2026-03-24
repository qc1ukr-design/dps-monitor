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

  const candidates = [
    'corr/correspondence',
    'corr/inbox',
    'corr/outbox',
    'payer/corr',
    'inbox',
    'mail/inbox',
    'docs/in',
    'corr',
    'letters/inbox',
    'corr/correspondence?page=0&limit=10',
  ]

  const results: Record<string, unknown> = {}
  for (const ep of candidates) {
    results[ep] = await tryEndpoint(ep, authHeader)
  }

  return NextResponse.json(results)
}
