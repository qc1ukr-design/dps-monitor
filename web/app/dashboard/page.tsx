import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { normalizeBudget } from '@/lib/dps/normalizer'
import type { BudgetCalculations } from '@/lib/dps/types'
import SyncAllButton from './sync-all-button'
import ExcelExportButton from './excel-export-button'

// ── Helpers ───────────────────────────────────────────────────────────────

function formatMoney(n: number): string {
  if (n === 0) return '—'
  return new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 0 }).format(n) + '\u00a0грн'
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Не синхронізовано'
  const d = new Date(iso)
  return d.toLocaleString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Kiev',
  })
}

function calcBudget(data: unknown): { totalDebt: number; totalOverpayment: number } {
  const budget = normalizeBudget(data) as BudgetCalculations
  let totalDebt = 0
  let totalOverpayment = 0
  for (const row of budget.calculations ?? []) {
    totalDebt += row.debt ?? 0
    totalOverpayment += row.overpayment ?? 0
  }
  return { totalDebt, totalOverpayment }
}

// ── Component ─────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch all clients
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, edrpou')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const clientIds = clients?.map(c => c.id) ?? []

  // Fetch cache and KEP tokens in parallel
  const [cacheResult, tokenResult] = await Promise.all([
    clientIds.length
      ? supabase
          .from('dps_cache')
          .select('client_id, data_type, data, fetched_at, is_mock')
          .in('client_id', clientIds)
          .in('data_type', ['profile', 'budget'])
      : { data: [] },
    clientIds.length
      ? supabase
          .from('api_tokens')
          .select('client_id, kep_owner_name, kep_valid_to')
          .eq('user_id', user.id)
          .not('kep_encrypted', 'is', null)
      : { data: [] },
  ])

  const cacheRows = cacheResult.data ?? []
  const tokens = tokenResult.data ?? []

  const kepClientIds = new Set(tokens.map(t => t.client_id))
  const kepTokenMap = new Map(tokens.map(t => [t.client_id, t]))
  const dashboardNow = new Date()

  // Build per-client data
  type ClientRow = {
    id: string
    name: string
    edrpou: string | null
    taxStatus: string
    totalDebt: number
    totalOverpayment: number
    hasKep: boolean
    kepExpired: boolean
    kepExpiringSoon: boolean
    lastSynced: string | null
  }

  const clientRows: ClientRow[] = (clients ?? []).map((c) => {
    const profileCache = cacheRows.find(r => r.client_id === c.id && r.data_type === 'profile')
    const budgetCache = cacheRows.find(r => r.client_id === c.id && r.data_type === 'budget')

    const taxStatus = profileCache?.data
      ? (profileCache.data as Record<string, unknown>).status as string ?? ''
      : ''

    const { totalDebt, totalOverpayment } = budgetCache?.data
      ? calcBudget(budgetCache.data)
      : { totalDebt: 0, totalOverpayment: 0 }

    // Max fetched_at across profile and budget
    const times = [profileCache?.fetched_at, budgetCache?.fetched_at]
      .filter(Boolean) as string[]
    const lastSynced = times.length
      ? times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
      : null

    const token = kepTokenMap.get(c.id)
    const kepValidTo = token?.kep_valid_to ? new Date(token.kep_valid_to) : null
    const kepExpired = kepValidTo ? kepValidTo < dashboardNow : false
    const kepExpiringSoon = !kepExpired && kepValidTo
      ? (kepValidTo.getTime() - dashboardNow.getTime()) < 30 * 24 * 60 * 60 * 1000
      : false

    return {
      id: c.id,
      name: c.name,
      edrpou: c.edrpou ?? null,
      taxStatus,
      totalDebt,
      totalOverpayment,
      hasKep: kepClientIds.has(c.id),
      kepExpired,
      kepExpiringSoon,
      lastSynced,
    }
  })

  // Summary aggregates
  const totalDebtAll = clientRows.reduce((s, r) => s + r.totalDebt, 0)
  const totalOverpaymentAll = clientRows.reduce((s, r) => s + r.totalOverpayment, 0)
  const clientsWithDebt = clientRows.filter(r => r.totalDebt > 0).length
  const totalClients = clientRows.length

  const hasClients = totalClients > 0

  const modules = [
    { icon: '🏢', title: 'Профіль платника', desc: 'Назва, ЄДРПОУ, статус', active: true, href: '/dashboard/clients', download: false },
    { icon: '💰', title: 'Розрахунки з бюджетом', desc: 'Борги, переплати, нарахування', active: true, href: '/dashboard/clients', download: false },
    { icon: '📥', title: 'Вхідна документація', desc: 'Листи та повідомлення від ДПС', active: true, href: '/dashboard/clients', download: false },
    { icon: '📋', title: 'Звітність', desc: 'Статуси поданих звітів', active: true, href: '/dashboard/clients', download: false },
    { icon: '🔔', title: 'Алерти', desc: 'Нові борги та повідомлення', active: true, href: '/dashboard/alerts', download: false },
    { icon: '📊', title: 'Excel-звіт', desc: 'Зведений звіт по всіх клієнтах', active: hasClients, href: '/api/export/excel', download: true },
  ]

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* ── Section 1: Summary cards ─────────────────────────────────── */}
        {hasClients && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total debt */}
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Загальний борг</span>
                <span className="text-xl">💰</span>
              </div>
              <p className={`text-2xl font-bold leading-none ${totalDebtAll > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {formatMoney(totalDebtAll)}
              </p>
              <p className="text-xs text-gray-400 mt-1.5">По всіх контрагентах</p>
            </div>

            {/* Total overpayment */}
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Переплата</span>
                <span className="text-xl">📈</span>
              </div>
              <p className={`text-2xl font-bold leading-none ${totalOverpaymentAll > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                {formatMoney(totalOverpaymentAll)}
              </p>
              <p className="text-xs text-gray-400 mt-1.5">Сума переплат</p>
            </div>

            {/* Clients with debt */}
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">З боргом</span>
                <span className="text-xl">⚠️</span>
              </div>
              <p className={`text-2xl font-bold leading-none ${clientsWithDebt > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                {clientsWithDebt === 0 ? '—' : clientsWithDebt}
              </p>
              <p className="text-xs text-gray-400 mt-1.5">Контрагентів</p>
            </div>

            {/* Total counterparties */}
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Всього</span>
                <span className="text-xl">👥</span>
              </div>
              <p className="text-2xl font-bold leading-none text-gray-900">{totalClients}</p>
              <p className="text-xs text-gray-400 mt-1.5">Контрагентів</p>
            </div>
          </div>
        )}

        {/* ── Section 2 + 3: Table with sync button ────────────────────── */}
        {hasClients ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Стан контрагентів</h2>
              <SyncAllButton />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-5 py-3 font-medium text-gray-500 whitespace-nowrap">Контрагент</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">ЄДРПОУ</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Статус</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Борг</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Переплата</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Оновлено</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Дія</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {clientRows.map((row) => (
                      <tr key={row.id} className="hover:bg-blue-50/30 transition-colors">
                        {/* Name */}
                        <td className="px-5 py-3.5">
                          <Link
                            href={`/dashboard/client/${row.id}`}
                            className="font-medium text-gray-900 hover:text-blue-600 transition-colors"
                          >
                            {row.name}
                          </Link>
                        </td>

                        {/* EDRPOU */}
                        <td className="px-4 py-3.5 text-gray-500 font-mono text-xs">
                          {row.edrpou ?? <span className="text-gray-300">—</span>}
                        </td>

                        {/* Tax status */}
                        <td className="px-4 py-3.5">
                          {row.taxStatus ? (
                            <span className="inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                              {row.taxStatus}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>

                        {/* Debt */}
                        <td className="px-4 py-3.5 text-right font-medium tabular-nums">
                          {row.totalDebt > 0 ? (
                            <span className="text-red-600">{formatMoney(row.totalDebt)}</span>
                          ) : (
                            <span className="text-green-500 font-normal">—</span>
                          )}
                        </td>

                        {/* Overpayment */}
                        <td className="px-4 py-3.5 text-right font-medium tabular-nums">
                          {row.totalOverpayment > 0 ? (
                            <span className="text-green-600">{formatMoney(row.totalOverpayment)}</span>
                          ) : (
                            <span className="text-gray-300 font-normal">—</span>
                          )}
                        </td>

                        {/* Last synced */}
                        <td className="px-4 py-3.5 text-gray-400 text-xs whitespace-nowrap">
                          {row.lastSynced
                            ? formatDate(row.lastSynced)
                            : <span className="text-amber-500">Не синхронізовано</span>}
                        </td>

                        {/* Action */}
                        <td className="px-4 py-3.5 text-center">
                          <div className="flex flex-col items-center gap-1">
                            {row.hasKep ? (
                              <Link
                                href={`/dashboard/client/${row.id}`}
                                className="inline-block text-xs bg-blue-50 text-blue-600 border border-blue-200 px-3 py-1 rounded-lg hover:bg-blue-100 transition font-medium"
                              >
                                Переглянути
                              </Link>
                            ) : (
                              <Link
                                href={`/dashboard/client/${row.id}/settings`}
                                className="inline-block text-xs bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1 rounded-lg hover:bg-amber-100 transition font-medium whitespace-nowrap"
                              >
                                Налаштувати КЕП
                              </Link>
                            )}
                            {row.kepExpired && (
                              <Link href={`/dashboard/client/${row.id}/settings`} className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap">
                                ⚠ КЕП прострочено
                              </Link>
                            )}
                            {row.kepExpiringSoon && (
                              <Link href={`/dashboard/client/${row.id}/settings`} className="text-xs text-amber-500 hover:text-amber-700 whitespace-nowrap">
                                ⚠ КЕП закінчується
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* Empty state */
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
            <p className="text-gray-900 font-semibold text-lg mb-1">Додайте першого контрагента</p>
            <p className="text-gray-500 text-sm mb-6">
              Введіть назву клієнта та підключіть КЕП, щоб розпочати моніторинг
            </p>
            <Link
              href="/dashboard/clients/new"
              className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
            >
              Додати контрагента
            </Link>
          </div>
        )}

        {/* ── Section 4: Modules grid ───────────────────────────────────── */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Модулі</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {modules.filter(m => !m.download).map((m) => {
              const inner = (
                <>
                  <div className="text-2xl mb-3">{m.icon}</div>
                  <h3 className="font-semibold text-gray-900">{m.title}</h3>
                  <p className="text-sm text-gray-500 mt-1">{m.desc}</p>
                  <span
                    className={`mt-3 inline-block text-xs px-2 py-0.5 rounded font-medium ${
                      m.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {m.active ? 'Активний' : 'Незабаром'}
                  </span>
                </>
              )
              const cls = `bg-white rounded-xl border p-5 transition ${
                m.active
                  ? 'border-blue-200 hover:shadow-md cursor-pointer'
                  : 'border-gray-200 opacity-60'
              }`
              return m.active && m.href ? (
                <Link key={m.title} href={m.href} className={cls}>{inner}</Link>
              ) : (
                <div key={m.title} className={cls}>{inner}</div>
              )
            })}
            {/* Excel export — client component with loading state */}
            {hasClients && <ExcelExportButton />}
          </div>
        </div>

    </div>
  )
}
