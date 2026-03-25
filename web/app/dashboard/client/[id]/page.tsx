import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import TaxpayerProfileCard from '@/components/taxpayer-profile'
import BudgetCalculationsTable from '@/components/budget-calculations'
import { MOCK_PROFILE, MOCK_BUDGET } from '@/lib/dps/mock-data'
import { normalizeProfile, normalizeBudget } from '@/lib/dps/normalizer'
import { alertIcon } from '@/lib/dps/alerts'
import type { AlertType } from '@/lib/dps/alerts'
import SyncButton from './sync-button'
import DeleteButton from './delete-button'
import MarkReadButton from '@/app/dashboard/alerts/mark-read-button'

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

  // Load cached DPS data + unread alerts in parallel
  const [cacheResult, alertsResult] = await Promise.all([
    supabase
      .from('dps_cache')
      .select('data_type, data, fetched_at, is_mock')
      .eq('client_id', id)
      .eq('user_id', user.id),
    supabase
      .from('alerts')
      .select('id, type, message, created_at')
      .eq('client_id', id)
      .eq('user_id', user.id)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const cacheRows = cacheResult.data ?? []
  const unreadAlerts = alertsResult.data ?? []

  const profileCache = cacheRows.find(r => r.data_type === 'profile')
  const budgetCache  = cacheRows.find(r => r.data_type === 'budget')

  const profileData = profileCache?.data ? normalizeProfile(profileCache.data) : MOCK_PROFILE
  const budgetData  = budgetCache?.data  ? normalizeBudget(budgetCache.data)   : MOCK_BUDGET
  const profileIsMock = !profileCache || profileCache.is_mock
  const budgetIsMock  = !budgetCache  || budgetCache.is_mock

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
            <DeleteButton clientId={id} clientName={client.name} />
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
              Оновлено: {lastSynced.toLocaleString('uk-UA', { timeZone: 'Europe/Kiev', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {!kepConfigured && (
            <span className="text-xs text-amber-600">
              KEP не підключено — показуються демо-дані
            </span>
          )}
        </div>
      </div>

      {/* ── Unread alerts banner ─────────────────────────────────────────── */}
      {unreadAlerts.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-blue-900">
              🔔 {unreadAlerts.length === 1
                ? '1 непрочитаний алерт'
                : `${unreadAlerts.length} непрочитаних алертів`}
            </p>
            <div className="flex items-center gap-3">
              <MarkReadButton clientId={id} label="Позначити як прочитані" />
              <Link
                href="/dashboard/alerts"
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Всі алерти →
              </Link>
            </div>
          </div>
          <ul className="space-y-1.5">
            {unreadAlerts.map(alert => (
              <li key={alert.id} className="flex items-start gap-2 text-sm text-blue-800">
                <span className="flex-shrink-0">{alertIcon(alert.type as AlertType)}</span>
                <span>{alert.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <TaxpayerProfileCard profile={profileData} isMock={profileIsMock} />
      <BudgetCalculationsTable data={budgetData} isMock={budgetIsMock} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href={`/dashboard/client/${id}/documents`} className="block">
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-5 hover:border-blue-300 hover:shadow-sm transition flex items-center justify-between h-full">
            <div>
              <h2 className="text-base font-semibold text-gray-900">📥 Вхідна документація</h2>
              <p className="text-sm text-gray-500 mt-0.5">Листи та повідомлення від ДПС</p>
            </div>
            <span className="text-gray-400">→</span>
          </div>
        </Link>
        <Link href={`/dashboard/client/${id}/reports`} className="block">
          <div className="bg-white rounded-xl border border-gray-200 px-6 py-5 hover:border-blue-300 hover:shadow-sm transition flex items-center justify-between h-full">
            <div>
              <h2 className="text-base font-semibold text-gray-900">📋 Звітність</h2>
              <p className="text-sm text-gray-500 mt-0.5">Статуси поданих звітів</p>
            </div>
            <span className="text-gray-400">→</span>
          </div>
        </Link>
      </div>
    </div>
  )
}
