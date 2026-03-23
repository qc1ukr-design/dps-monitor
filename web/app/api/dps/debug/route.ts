import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'

const DPS_BASE_URL = 'https://cabinet.tax.gov.ua/ws/public_api'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('clientId')

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 })
  }

  // Fetch token from DB
  const { data: tokenRow, error: tokenError } = await supabase
    .from('api_tokens')
    .select('token_encrypted')
    .eq('client_id', clientId)
    .eq('user_id', user.id)
    .single()

  if (tokenError || !tokenRow?.token_encrypted) {
    return NextResponse.json({ error: 'Token not found in DB', dbError: tokenError?.message })
  }

  let token: string
  try {
    token = decrypt(tokenRow.token_encrypted)
  } catch (e) {
    return NextResponse.json({ error: 'Decrypt failed', detail: String(e) })
  }

  const tokenPreview = token.substring(0, 8) + '...' + token.substring(token.length - 4)

  // Test DPS API
  const results: Record<string, unknown> = { tokenPreview, tokenLength: token.length }

  for (const [name, endpoint] of [
    ['payer_card', 'payer_card'],
    ['budget', `ta/splatp?year=${new Date().getFullYear()}`],
  ]) {
    try {
      const res = await fetch(`${DPS_BASE_URL}/${endpoint}`, {
        method: 'GET',
        headers: {
          Authorization: token,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      })

      let body: unknown = null
      try { body = await res.json() } catch { body = await res.text() }

      results[name] = {
        status: res.status,
        ok: res.ok,
        body,
      }
    } catch (e) {
      results[name] = { error: String(e) }
    }
  }

  return NextResponse.json(results)
}
