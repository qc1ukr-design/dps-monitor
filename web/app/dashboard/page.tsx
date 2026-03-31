import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { normalizeBudget } from '@/lib/dps/normalizer'
import type { BudgetCalculations } from '@/lib/dps/types'
import SyncAllButton from './sync-all-button'
import ExcelExportButton from './excel-export-button'
import ClientsTable from './clients-table'
import type { ClientRowData } from './clients-table'

// ── Helpers ───────────────────────────────────────────────────────────────

function formatMoney(n: number): string {
  if (n === 0) return '—'
  return new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 0 }).format(n) + '\u00a0грн'
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

  // Fetch all clients (including archived)
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, edrpou, is_archived')
    .eq('user_id', user.id)
    .order('name', { ascending: true })

  const clientIds = clients?.map(c => c.id) ?? []

  // Fetch cache and KEP tokens in parallel
  const [cacheResult, tokenResult] = await Promise.all([
    clientIds.length
      ? supabase
          .from('dps_cache')
          .select('client_id, data_type, data, fetched_at')
          .in('client_id', clientIds)
          .in('data_type', ['profile', 'budget'])
      : { data: [] },
    clientIds.length
      ? supabase
          .from('api_tokens')
          .select('client_id, kep_valid_to')
          .eq('user_id', user.id)
          .not('kep_encrypted', 'is', null)
      : { data: [] },
  ])

  const cacheRows = cacheResult.data ?? []
  const tokens    = tokenResult.data ?? []

  const kepClientIds = new Set(tokens.map(t => t.client_id))
  const kepTokenMap  = new Map(tokens.map(t => [t.client_id, t]))
  const now          = new Date()

  // Build per-client rows
  const tableData: ClientRowData[] = (clients ?? []).map((c) => {
    const profileCache = cacheRows.find(r => r.client_id === c.id && r.data_type === 'profile')
    const budgetCache  = cacheRows.find(r => r.client_id === c.id && r.data_type === 'budget')

    const taxStatus = profileCache?.data
      ? (profileCache.data as Record<string, unknown>).status as string ?? ''
      : ''

    const { totalDebt, totalOverpayment } = budgetCache?.data
      ? calcBudget(budgetCache.data)
      : { totalDebt: 0, totalOverpayment: 0 }

    const times = [profileCache?.fetched_at, budgetCache?.fetched_at].filter(Boolean) as string[]
    const lastSynced = times.length
      ? times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
      : null

    const token      = kepTokenMap.get(c.id)
    const kepValidTo = token?.kep_valid_to ? new Date(token.kep_valid_to) : null
    const kepExpired = kepValidTo ? kepValidTo < now : false
    const kepExpiringSoon = !kepExpired && kepValidTo
      ? (kepValidTo.getTime() - now.getTime()) < 30 * 24 * 60 * 60 * 1000
      : false

    const hasKep = kepClientIds.has(c.id)
    const isSyncStale = hasKep && (
      !lastSynced ||
      (now.getTime() - new Date(lastSynced).getTime()) > 48 * 60 * 60 * 1000
    )

    const isArchived = (c as { is_archived?: boolean }).is_archived ?? false

    return {
      id: c.id,
      name: c.name,
      edrpou: c.edrpou ?? null,
      taxStatus,
      totalDebt,
      totalOverpayment,
      hasKep,
      kepExpired,
      kepExpiringSoon,
      kepValidToISO: kepValidTo?.toISOString() ?? null,
      lastSynced,
      isSyncStale,
      isArchived,
    }
  })

  // Summary aggregates — only active (non-archived) clients
  const activeRows       = tableData.filter(r => !r.isArchived)
  const totalDebtAll     = activeRows.reduce((s, r) => s + r.totalDebt, 0)
  const totalOverpayAll  = activeRows.reduce((s, r) => s + r.totalOverpayment, 0)
  const clientsWithDebt  = activeRows.filter(r => r.totalDebt > 0).length
  const totalClients     = activeRows.length

  const hasClients = tableData.length > 0

  const modules = [
    { icon: '🏢', title: 'Профіль платника',      desc: 'Назва, ЄДРПОУ, статус',             active: true,       href: '/dashboard/clients', download: false },
    { icon: '💰', title: 'Розрахунки з бюджетом', desc: 'Борги, переплати, нарахування',      active: true,       href: '/dashboard/clients', download: false },
    { icon: '📥', title: 'Вхідна документація',   desc: 'Листи та повідомлення від ДПС',      active: true,       href: '/dashboard/clients', download: false },
    { icon: '📋', title: 'Звітність',              desc: 'Статуси поданих звітів',             active: true,       href: '/dashboard/clients', download: false },
    { icon: '🔔', title: 'Алерти',                 desc: 'Нові борги та повідомлення',         active: true,       href: '/dashboard/alerts',  download: false },
    { icon: '📊', title: 'Excel-звіт',             desc: 'Зведений звіт по всіх клієнтах',    active: hasClients, href: '/api/export/excel',  download: true  },
  ]

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">

      {/* ── Section 1: Summary cards ───────────────────────────────────── */}
      {totalClients > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Загальний борг</span>
              <span className="text-xl">💰</span>
            </div>
            <p className={`text-2xl font-bold leading-none ${totalDebtAll > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {formatMoney(totalDebtAll)}
            </p>
            <p className="text-xs text-gray-400 mt-1.5">По активних контрагентах</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Переплата</span>
              <span className="text-xl">📈</span>
            </div>
            <p className={`text-2xl font-bold leading-none ${totalOverpayAll > 0 ? 'text-green-600' : 'text-gray-400'}`}>
              {formatMoney(totalOverpayAll)}
            </p>
            <p className="text-xs text-gray-400 mt-1.5">Сума переплат</p>
          </div>

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

          <div className="bg-white rounded-xl border border-gray-200 px-5 py-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Всього</span>
              <span className="text-xl">👥</span>
            </div>
            <p className="text-2xl font-bold leading-none text-gray-900">{totalClients}</p>
            <p className="text-xs text-gray-400 mt-1.5">Активних</p>
          </div>
        </div>
      )}

      {/* ── Section 2: Table ───────────────────────────────────────────── */}
      {hasClients ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-900">Стан контрагентів</h2>
            <SyncAllButton />
          </div>
          <ClientsTable rows={tableData} />
        </div>
      ) : (
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

      {/* ── Section 3: Modules grid ────────────────────────────────────── */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Модулі</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.filter(m => !m.download).map((m) => {
            const inner = (
              <>
                <div className="text-2xl mb-3">{m.icon}</div>
                <h3 className="font-semibold text-gray-900">{m.title}</h3>
                <p className="text-sm text-gray-500 mt-1">{m.desc}</p>
                <span className={`mt-3 inline-block text-xs px-2 py-0.5 rounded font-medium ${
                  m.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {m.active ? 'Активний' : 'Незабаром'}
                </span>
              </>
            )
            const cls = `bg-white rounded-xl border p-5 transition ${
              m.active ? 'border-blue-200 hover:shadow-md cursor-pointer' : 'border-gray-200 opacity-60'
            }`
            return m.active && m.href ? (
              <Link key={m.title} href={m.href} className={cls}>{inner}</Link>
            ) : (
              <div key={m.title} className={cls}>{inner}</div>
            )
          })}
          {hasClients && <ExcelExportButton />}
        </div>
      </div>

    </div>
  )
}
