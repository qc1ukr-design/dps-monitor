import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import TaxpayerProfileCard from '@/components/taxpayer-profile'
import BudgetCalculationsTable from '@/components/budget-calculations'
import { MOCK_PROFILE, MOCK_BUDGET } from '@/lib/dps/mock-data'
import { normalizeProfile, normalizeBudget } from '@/lib/dps/normalizer'
import SyncButton from './sync-button'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ClientPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: client, error } = await supabase
    .from('clients')
    .select('id, name, edrpou')
    .eq('id', id)
    .single()

  if (error || !client) notFound()

  // Check if KEP is configured
  const { data: tokenRow } = await supabase
    .from('api_tokens')
    .select('kep_ca_name, kep_owner_name, kep_valid_to')
    .eq('client_id', id)
    .eq('user_id', user.id)
    .single()

  const kepConfigured = !!tokenRow?.kep_ca_name

  // Load cached DPS data
  const { data: cacheRows } = await supabase
    .from('dps_cache')
    .select('data_type, data, fetched_at, is_mock')
    .eq('client_id', id)
    .eq('user_id', user.id)

  const profileCache = cacheRows?.find(r => r.data_type === 'profile')
  const budgetCache = cacheRows?.find(r => r.data_type === 'budget')

  const profileData = profileCache?.data ? normalizeProfile(profileCache.data) : MOCK_PROFILE
  const budgetData = budgetCache?.data ? normalizeBudget(budgetCache.data) : MOCK_BUDGET
  const profileIsMock = !profileCache || profileCache.is_mock
  const budgetIsMock = !budgetCache || budgetCache.is_mock

  // Most recent sync time
  const syncTimes = [profileCache?.fetched_at, budgetCache?.fetched_at].filter(Boolean)
  const lastSynced = syncTimes.length
    ? new Date(Math.max(...syncTimes.map(t => new Date(t!).getTime())))
    : null

  return (
    <div className="max-w-4xl mx-auto py-10 px-4 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/clients" className="text-sm text-gray-400 hover:text-gray-600">
            ← Контрагенти
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">{client.name}</h1>
          {client.edrpou && (
            <p className="text-gray-500 text-sm">ЄДРПОУ: {client.edrpou}</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 mt-1">
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/client/${id}/settings`}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              ⚙ Налаштування
            </Link>
            {kepConfigured ? (
              <SyncButton clientId={id} />
            ) : (
              <Link
                href={`/dashboard/client/${id}/settings`}
                className="bg-amber-50 text-amber-700 border border-amber-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-100 transition"
              >
                Підключити KEP →
              </Link>
            )}
          </div>
          {lastSynced && (
            <span className="text-xs text-gray-400">
              Оновлено: {lastSynced.toLocaleString('uk-UA')}
            </span>
          )}
          {!kepConfigured && (
            <span className="text-xs text-amber-600">
              KEP не підключено — показуються демо-дані
            </span>
          )}
        </div>
      </div>

      <TaxpayerProfileCard profile={profileData} isMock={profileIsMock} />
      <BudgetCalculationsTable data={budgetData} isMock={budgetIsMock} />
    </div>
  )
}
