import { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import { MOCK_PROFILE, MOCK_BUDGET } from './mock-data'
import type { TaxpayerProfile, BudgetCalculations, DpsApiResponse } from './types'

const DPS_BASE_URL = 'https://cabinet.tax.gov.ua/ws/public_api'

async function getToken(clientId: string, userId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('api_tokens')
    .select('token_encrypted')
    .eq('client_id', clientId)
    .eq('user_id', userId)
    .single()

  if (!data?.token_encrypted) return null
  try {
    return decrypt(data.token_encrypted).trim()
  } catch {
    return null
  }
}

async function dpsGet(endpoint: string, token: string) {
  const res = await fetch(`${DPS_BASE_URL}/${endpoint}`, {
    method: 'GET',
    headers: {
      Authorization: token,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  })
  if (!res.ok) {
    console.warn(`DPS ${endpoint} → HTTP ${res.status}`)
    return null
  }
  return res.json()
}

export async function fetchProfile(
  clientId: string,
  userId: string
): Promise<DpsApiResponse<TaxpayerProfile>> {
  const token = await getToken(clientId, userId)
  if (!token) return { data: MOCK_PROFILE, error: 'No token', isMock: true }

  try {
    const data = await dpsGet('payer_card', token)
    if (data) return { data, error: null, isMock: false }
  } catch (e) {
    console.warn('fetchProfile error:', e)
  }
  return { data: MOCK_PROFILE, error: null, isMock: true }
}

export async function fetchBudget(
  clientId: string,
  userId: string
): Promise<DpsApiResponse<BudgetCalculations>> {
  const token = await getToken(clientId, userId)
  if (!token) return { data: MOCK_BUDGET, error: 'No token', isMock: true }

  const year = new Date().getFullYear()
  try {
    const raw = await dpsGet(`ta/splatp?year=${year}`, token)
    if (raw) return { data: raw, error: null, isMock: false }
  } catch (e) {
    console.warn('fetchBudget error:', e)
  }
  return { data: MOCK_BUDGET, error: null, isMock: true }
}
