import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'

const DPS_BASE_URL = 'https://cabinet.tax.gov.ua/ws/public_api'

async function tryFetch(url: string, authHeader: string) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authHeader, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    let body: unknown
    try { body = await res.json() } catch { body = await res.text() }
    return { status: res.status, ok: res.ok, body }
  } catch (e) {
    return { error: String(e) }
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 })

  const { data: tokenRow, error: tokenError } = await supabase
    .from('api_tokens')
    .select('token_encrypted')
    .eq('client_id', clientId)
    .eq('user_id', user.id)
    .single()

  if (tokenError || !tokenRow?.token_encrypted) {
    return NextResponse.json({ error: 'Token not found', dbError: tokenError?.message })
  }

  let token: string
  try { token = decrypt(tokenRow.token_encrypted) }
  catch (e) { return NextResponse.json({ error: 'Decrypt failed', detail: String(e) }) }

  const tokenPreview = token.substring(0, 8) + '...' + token.substring(token.length - 4)
  const endpoint = `${DPS_BASE_URL}/payer_card`

  // Test 4 auth formats in parallel
  const [plain, bearer, token_prefix, uuid_header] = await Promise.all([
    tryFetch(endpoint, token),
    tryFetch(endpoint, `Bearer ${token}`),
    tryFetch(endpoint, `Token ${token}`),
    tryFetch(endpoint, `UUID ${token}`),
  ])

  return NextResponse.json({
    tokenPreview,
    tokenLength: token.length,
    tests: {
      'Authorization: <token>': plain,
      'Authorization: Bearer <token>': bearer,
      'Authorization: Token <token>': token_prefix,
      'Authorization: UUID <token>': uuid_header,
    }
  })
}
