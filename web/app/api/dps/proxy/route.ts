import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import { MOCK_PROFILE, MOCK_BUDGET } from '@/lib/dps/mock-data'

const DPS_BASE_URL = 'https://cabinet.tax.gov.ua/api'

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

  if (tokenError || !tokenRow) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  }

  const token = decrypt(tokenRow.token_encrypted)

  // Mock data — повертаємо поки API ДПС не підключено
  if (process.env.DPS_USE_MOCK === 'true' || !process.env.DPS_API_ENABLED) {
    return NextResponse.json({ data: getMockData(endpoint), isMock: true })
  }

  // Реальний запит до API ДПС
  try {
    const response = await fetch(`${DPS_BASE_URL}/${endpoint}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      // Якщо реальний API недоступний — fallback на mock
      return NextResponse.json({ data: getMockData(endpoint), isMock: true })
    }

    const data = await response.json()
    return NextResponse.json({ data, isMock: false })
  } catch {
    // Network error — fallback на mock
    return NextResponse.json({ data: getMockData(endpoint), isMock: true })
  }
}

function getMockData(endpoint: string) {
  if (endpoint.includes('profile') || endpoint.includes('platnik')) return MOCK_PROFILE
  if (endpoint.includes('budget') || endpoint.includes('rozrahunky')) return MOCK_BUDGET
  return null
}
