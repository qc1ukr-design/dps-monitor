/**
 * GET /api/clients/[id]/documents
 *
 * Fetches DPS correspondence using Bearer token (api_tokens.token_encrypted).
 * KEP-only clients cannot access correspondence — returns mock data with noToken flag.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import { normalizeDocuments } from '@/lib/dps/normalizer'
import { MOCK_DOCUMENTS } from '@/lib/dps/mock-data'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: tokenRow } = await supabase
    .from('api_tokens')
    .select('token_encrypted')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .single()

  if (!tokenRow?.token_encrypted) {
    return NextResponse.json({ ...MOCK_DOCUMENTS, noToken: true, isMock: true })
  }

  let token: string
  try {
    token = decrypt(tokenRow.token_encrypted).trim()
  } catch {
    return NextResponse.json({ ...MOCK_DOCUMENTS, noToken: false, isMock: true })
  }

  try {
    const res = await fetch(
      'https://cabinet.tax.gov.ua/ws/a/corr/correspondence?page=0&limit=50',
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
        cache: 'no-store',
      }
    )
    if (res.ok) {
      const raw = await res.json()
      const normalized = normalizeDocuments(raw)
      return NextResponse.json({ ...normalized, noToken: false, isMock: false })
    }
  } catch {
    /* fallback to mock */
  }

  return NextResponse.json({ ...MOCK_DOCUMENTS, noToken: false, isMock: true })
}
