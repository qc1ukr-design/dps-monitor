import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import { MOCK_PROFILE, MOCK_BUDGET } from '@/lib/dps/mock-data'

const DPS_BASE_URL = 'https://cabinet.tax.gov.ua/ws/public_api'

// Маппінг наших ендпоінтів → реальні ДПС API ендпоінти
function mapEndpoint(endpoint: string): string {
  const year = new Date().getFullYear()
  const map: Record<string, string> = {
    profile:  'payer_card',
    budget:   `ta/splatp?year=${year}`,
  }
  return map[endpoint] ?? endpoint
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { clientId, endpoint } = body as { clientId: string; endpoint: string }

  if (!clientId || !endpoint) {
    return NextResponse.json({ error: 'clientId and endpoint are required' }, { status: 400 })
  }

  // Отримуємо зашифрований токен з БД
  const { data: tokenRow, error: tokenError } = await supabase
    .from('api_tokens')
    .select('token_encrypted')
    .eq('client_id', clientId)
    .eq('user_id', user.id)
    .single()

  if (tokenError || !tokenRow?.token_encrypted) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  }

  let token: string
  try {
    token = decrypt(tokenRow.token_encrypted).trim()
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt token' }, { status: 500 })
  }

  const dpsEndpoint = mapEndpoint(endpoint)

  // Реальний запит до API ДПС
  try {
    const response = await fetch(`${DPS_BASE_URL}/${dpsEndpoint}`, {
      method: 'GET',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (response.ok) {
      const data = await response.json()
      return NextResponse.json({ data, isMock: false })
    }

    // Якщо помилка авторизації або інша — fallback на mock
    console.warn(`DPS API ${dpsEndpoint} → ${response.status}`)
    return NextResponse.json({ data: getMockData(endpoint), isMock: true, dpsStatus: response.status })
  } catch (err) {
    // Мережева помилка або timeout — fallback на mock
    console.warn(`DPS API error:`, err)
    return NextResponse.json({ data: getMockData(endpoint), isMock: true })
  }
}

function getMockData(endpoint: string) {
  if (endpoint === 'profile') return MOCK_PROFILE
  if (endpoint === 'budget') return MOCK_BUDGET
  return null
}
