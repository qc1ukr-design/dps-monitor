'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ClientRowData = {
  id: string
  name: string
  edrpou: string | null
  taxStatus: string
  totalDebt: number
  totalOverpayment: number
  hasKep: boolean
  kepExpired: boolean
  kepExpiringSoon: boolean
  kepValidToISO: string | null
  lastSynced: string | null
  isSyncStale: boolean
  isArchived: boolean
}

type SortKey = 'name' | 'debt' | 'synced' | 'kep'
type QuickFilter = 'all' | 'debt' | 'stale'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMoney(n: number): string {
  if (n === 0) return '—'
  return new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 0 }).format(n) + '\u00a0грн'
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Не синхронізовано'
  return new Date(iso).toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Kiev',
  })
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: 'asc' | 'desc' }) {
  if (sortKey !== col) return <span className="ml-1 text-gray-300 text-xs">⇅</span>
  return <span className="ml-1 text-xs">{sortDir === 'asc' ? '▲' : '▼'}</span>
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ClientsTable({ rows }: { rows: ClientRowData[] }) {
  const router = useRouter()
  const [search, setSearch]           = useState('')
  const [sortKey, setSortKey]         = useState<SortKey>('name')
  const [sortDir, setSortDir]         = useState<'asc' | 'desc'>('asc')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')
  const [showArchived, setShowArchived] = useState(false)
  const [unarchiving, setUnarchiving] = useState<string | null>(null)

  const activeRows   = useMemo(() => rows.filter(r => !r.isArchived), [rows])
  const archivedRows = useMemo(() => rows.filter(r => r.isArchived),  [rows])

  const staleCount = activeRows.filter(r => r.isSyncStale).length

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  async function handleUnarchive(clientId: string) {
    setUnarchiving(clientId)
    await fetch(`/api/clients/${clientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_archived: false }),
    })
    router.refresh()
    setUnarchiving(null)
  }

  const visibleRows = useMemo(() => {
    let list = activeRows

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r =>
        r.name.toLowerCase().includes(q) ||
        (r.edrpou ?? '').includes(q)
      )
    }

    if (quickFilter === 'debt')  list = list.filter(r => r.totalDebt > 0)
    if (quickFilter === 'stale') list = list.filter(r => r.isSyncStale)

    return [...list].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name')   cmp = a.name.localeCompare(b.name, 'uk')
      if (sortKey === 'debt')   cmp = b.totalDebt - a.totalDebt
      if (sortKey === 'synced') {
        const ta = a.lastSynced ? new Date(a.lastSynced).getTime() : 0
        const tb = b.lastSynced ? new Date(b.lastSynced).getTime() : 0
        cmp = ta - tb
      }
      if (sortKey === 'kep') {
        const ta = a.kepValidToISO ? new Date(a.kepValidToISO).getTime() : Infinity
        const tb = b.kepValidToISO ? new Date(b.kepValidToISO).getTime() : Infinity
        cmp = ta - tb
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [activeRows, search, quickFilter, sortKey, sortDir])

  return (
    <div className="space-y-3">

      {/* ── Controls ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Назва або ЄДРПОУ…"
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
          />
        </div>

        {/* Quick filters */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          {(['all', 'debt', 'stale'] as QuickFilter[]).map(f => {
            const labels: Record<QuickFilter, string> = {
              all:   'Всі',
              debt:  'З боргом',
              stale: staleCount > 0 ? `Не оновлюються\u00a0(${staleCount})` : 'Не оновлюються',
            }
            return (
              <button
                key={f}
                onClick={() => setQuickFilter(f)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
                  quickFilter === f
                    ? 'bg-white text-blue-700 shadow-sm'
                    : f === 'stale' && staleCount > 0
                      ? 'text-amber-700 hover:text-amber-900'
                      : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {labels[f]}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th
                  className="text-left px-5 py-3 font-medium text-gray-500 whitespace-nowrap cursor-pointer hover:text-gray-800 select-none"
                  onClick={() => handleSort('name')}
                >
                  Контрагент<SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">ЄДРПОУ</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Статус</th>
                <th
                  className="text-right px-4 py-3 font-medium text-gray-500 whitespace-nowrap cursor-pointer hover:text-gray-800 select-none"
                  onClick={() => handleSort('debt')}
                >
                  Борг<SortIcon col="debt" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Переплата</th>
                <th
                  className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap cursor-pointer hover:text-gray-800 select-none"
                  onClick={() => handleSort('synced')}
                >
                  Оновлено<SortIcon col="synced" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th
                  className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap cursor-pointer hover:text-gray-800 select-none"
                  onClick={() => handleSort('kep')}
                >
                  КЕП до<SortIcon col="kep" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className="text-center px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Дія</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-gray-400 text-sm">
                    {search || quickFilter !== 'all' ? 'Нічого не знайдено' : 'Немає контрагентів'}
                  </td>
                </tr>
              ) : visibleRows.map(row => {
                const kepValidTo = row.kepValidToISO ? new Date(row.kepValidToISO) : null
                return (
                  <tr
                    key={row.id}
                    className={`transition-colors ${
                      row.isSyncStale ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-blue-50/30'
                    }`}
                  >
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
                      {row.totalDebt > 0
                        ? <span className="text-red-600">{formatMoney(row.totalDebt)}</span>
                        : <span className="text-green-500 font-normal">—</span>}
                    </td>

                    {/* Overpayment */}
                    <td className="px-4 py-3.5 text-right font-medium tabular-nums">
                      {row.totalOverpayment > 0
                        ? <span className="text-green-600">{formatMoney(row.totalOverpayment)}</span>
                        : <span className="text-gray-300 font-normal">—</span>}
                    </td>

                    {/* Last synced */}
                    <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                      {row.isSyncStale ? (
                        <div className="flex flex-col gap-0.5">
                          {row.lastSynced && (
                            <span className="text-gray-400">{formatDate(row.lastSynced)}</span>
                          )}
                          <span className="text-amber-700 font-medium">⚠ Не оновлюється</span>
                        </div>
                      ) : row.lastSynced ? (
                        <span className="text-gray-400">{formatDate(row.lastSynced)}</span>
                      ) : (
                        <span className="text-amber-500">Не синхронізовано</span>
                      )}
                    </td>

                    {/* KEP valid to */}
                    <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                      {kepValidTo ? (
                        <span className={
                          row.kepExpired      ? 'text-red-600 font-semibold' :
                          row.kepExpiringSoon ? 'text-amber-600 font-semibold' :
                                               'text-gray-500'
                        }>
                          {kepValidTo.toLocaleDateString('uk-UA', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            timeZone: 'Europe/Kiev',
                          })}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
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
                        {row.isSyncStale && !row.kepExpired && (
                          <Link href={`/dashboard/client/${row.id}/settings`} className="text-xs text-amber-600 hover:text-amber-800 whitespace-nowrap font-medium">
                            Перевірити КЕП
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Archived section ─────────────────────────────────────────── */}
      {archivedRows.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived(v => !v)}
            className="text-sm text-gray-400 hover:text-gray-600 transition flex items-center gap-1.5 py-1"
          >
            <span className="text-xs">{showArchived ? '▼' : '▶'}</span>
            Архів ({archivedRows.length})
          </button>
          {showArchived && (
            <div className="mt-2 bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {archivedRows.map(row => (
                    <tr key={row.id} className="opacity-60 hover:opacity-80 transition-opacity">
                      <td className="px-5 py-3">
                        <Link href={`/dashboard/client/${row.id}`} className="font-medium text-gray-700 hover:text-blue-600">
                          {row.name}
                        </Link>
                        {row.edrpou && (
                          <span className="ml-2 text-gray-400 font-mono text-xs">{row.edrpou}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleUnarchive(row.id)}
                          disabled={unarchiving === row.id}
                          className="text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50 transition"
                        >
                          {unarchiving === row.id ? 'Розархівування…' : 'Розархівувати'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
