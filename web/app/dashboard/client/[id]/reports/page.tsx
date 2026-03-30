import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { decrypt } from '@/lib/crypto'
import { loginWithKep } from '@/lib/dps/dps-auth'
import { signWithKepDecrypted } from '@/lib/dps/signer'
import { normalizeReports } from '@/lib/dps/normalizer'
import type { ReportsList, TaxReport, BudgetCalculations } from '@/lib/dps/types'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ year?: string; tab?: string; period?: string }>
}

const DPS_API    = 'https://cabinet.tax.gov.ua/ws/api'
const DPS_PUBLIC = 'https://cabinet.tax.gov.ua/ws/public_api'
const DPS_A      = 'https://cabinet.tax.gov.ua/ws/a'

async function fetchReports(
  clientId: string,
  userId: string,
  year: number,
  clientEdrpou?: string
): Promise<ReportsList & { hasToken: boolean; isMock: boolean; tokenExpired: boolean; debugError?: string }> {
  const supabase = await createClient()
  const { data: tokenRow } = await supabase
    .from('api_tokens')
    .select('kep_encrypted, kep_password_encrypted, kep_tax_id, token_encrypted')
    .eq('client_id', clientId)
    .eq('user_id', userId)
    .single()

  const hasKep  = !!(tokenRow?.kep_encrypted && tokenRow?.kep_password_encrypted)
  const hasUuid = !!tokenRow?.token_encrypted

  if (!hasKep && !hasUuid) {
    return { reports: [], total: 0, hasToken: false, isMock: true, tokenExpired: false }
  }

  const urlPub = `${DPS_PUBLIC}/regdoc/list?periodYear=${year}&page=0&size=100&sort=dget,desc`
  const url    = `${DPS_API}/regdoc/list?periodYear=${year}&page=0&size=100&sort=dget,desc`
  const urlA   = `${DPS_A}/regdoc/list?periodYear=${year}&page=0&size=100&sort=dget,desc`
  const opts   = { Accept: 'application/json' }
  let kepDebug = '', uuidDebug = ''

  if (hasKep) {
    const kepDecrypted = decrypt(tokenRow!.kep_encrypted)
    const kepPwd       = decrypt(tokenRow!.kep_password_encrypted)
    const kepTaxId     = (tokenRow!.kep_tax_id ?? '').trim()

    // For ЮО: sign with ЄДРПОУ (8-digit) to get org context; for ФО: sign with kep_tax_id (РНОКПП)
    const signTaxId = (clientEdrpou && /^\d{8}$/.test(clientEdrpou)) ? clientEdrpou : kepTaxId

    // 1. Raw KEP auth on public_api — works for ЮО (signs ЄДРПОУ, returns org context)
    try {
      const sig = await signWithKepDecrypted(kepDecrypted, kepPwd, signTaxId)
      const res = await fetch(urlPub, {
        headers: { Authorization: sig, ...opts },
        signal: AbortSignal.timeout(15000), cache: 'no-store',
      })
      const rawText = await res.text()
      if (res.ok) {
        let rawJson: unknown = null
        try { rawJson = JSON.parse(rawText) } catch { /* not JSON */ }
        if (rawJson !== null) {
          const result = normalizeReports(rawJson)
          // Temporary debug: if empty, expose raw to UI
          if (result.reports.length === 0) {
            kepDebug = `pub→200 empty. raw: ${rawText.slice(0, 300)}`
          } else {
            return { ...result, hasToken: true, isMock: false, tokenExpired: false }
          }
        } else {
          kepDebug = `pub→200 non-JSON: ${rawText.slice(0, 200)}`
        }
      } else {
        kepDebug = `pub→${res.status}: ${rawText.slice(0, 200)}`
      }
    } catch (e) { kepDebug = `pub→${String(e).slice(0, 200)}` }

    // 2. OAuth Bearer on ws/api — works for ФО only
    // Skip for ЮО: OAuth returns personal ФО director context (F-forms), NOT ЮО J-forms
    const isYuo = !!(clientEdrpou && /^\d{8}$/.test(clientEdrpou))
    if (!isYuo) {
      try {
        const { accessToken } = await loginWithKep(kepDecrypted, kepPwd, kepTaxId)
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}`, ...opts },
          signal: AbortSignal.timeout(12000), cache: 'no-store',
        })
        if (res.ok) return { ...normalizeReports(await res.json()), hasToken: true, isMock: false, tokenExpired: false }
        kepDebug += ` oauth→${res.status}`
      } catch (e) { kepDebug += ` oauth→${String(e).slice(0, 80)}` }
    }
  }

  if (hasUuid) {
    try {
      const res = await fetch(urlA, {
        headers: { Authorization: `Bearer ${decrypt(tokenRow!.token_encrypted).trim()}`, ...opts },
        signal: AbortSignal.timeout(15000), cache: 'no-store',
      })
      if (res.ok) return { ...normalizeReports(await res.json()), hasToken: true, isMock: false, tokenExpired: false }
      uuidDebug = `uuid→${res.status}`
    } catch (e) { uuidDebug = `uuid→${String(e).slice(0, 80)}` }
  }

  return { reports: [], total: 0, hasToken: true, isMock: true, tokenExpired: false,
    debugError: [kepDebug, uuidDebug].filter(Boolean).join(' | ') }
}

// ── Period ───────────────────────────────────────────────────────────────────
type Period = 'month' | 'quarter' | 'year'

function getPeriodRange(period: Period) {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  if (period === 'month') {
    return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0),
      label: now.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' }) }
  }
  if (period === 'quarter') {
    const q = Math.floor(m / 3)
    return { from: new Date(y, q * 3, 1), to: new Date(y, q * 3 + 3, 0),
      label: `${q + 1} квартал ${y} р.` }
  }
  return { from: new Date(y, 0, 1), to: new Date(y, 11, 31), label: `${y} рік` }
}

function filterByPeriod(reports: TaxReport[], period: Period) {
  const { from, to } = getPeriodRange(period)
  return reports.filter(r => {
    if (!r.submittedAt) return false
    const d = new Date(r.submittedAt)
    return d >= from && d <= to
  })
}

// ── Formatters ───────────────────────────────────────────────────────────────
function formatDate(s: string) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kiev' })
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2 }).format(n) + '\u00a0грн'
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<TaxReport['status'], { dot: string; badge: string; label: string }> = {
  accepted:   { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',  label: 'Прийнято'  },
  rejected:   { dot: 'bg-red-500',     badge: 'bg-red-50 text-red-700 ring-1 ring-red-200',              label: 'Відхилено' },
  processing: { dot: 'bg-blue-500',    badge: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',           label: 'В обробці' },
  pending:    { dot: 'bg-gray-300',    badge: 'bg-gray-50 text-gray-500 ring-1 ring-gray-200',           label: 'Очікує'    },
}

function StatusBadge({ status, text }: { status: TaxReport['status']; text: string }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} flex-shrink-0`} />
      {text || cfg.label}
    </span>
  )
}

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 4 }, (_, i) => CURRENT_YEAR - i)

// ── Page ─────────────────────────────────────────────────────────────────────
export default async function ReportsPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const { year: yearParam, tab: tabParam, period: periodParam } = await searchParams

  const tab    = tabParam === 'submitted' ? 'submitted' : 'list'
  const period = (['month', 'quarter', 'year'] as Period[]).includes(periodParam as Period)
    ? (periodParam as Period) : 'quarter'
  const year   = Number(yearParam) || CURRENT_YEAR

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: client, error } = await supabase
    .from('clients').select('id, name, edrpou').eq('id', id).single()
  if (error || !client) notFound()

  const fetchYear = tab === 'submitted' ? CURRENT_YEAR : year
  const { reports, total, hasToken, isMock, tokenExpired, debugError } =
    await fetchReports(id, user.id, fetchYear, client.edrpou ?? undefined)

  // Debt from cache
  const { data: budgetCache } = await supabase
    .from('dps_cache').select('data, fetched_at')
    .eq('client_id', id).eq('data_type', 'budget').single()

  const budget = budgetCache?.data as BudgetCalculations | null
  const budgetDate = budgetCache?.fetched_at
    ? new Date(budgetCache.fetched_at).toLocaleDateString('uk-UA',
        { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Kiev' })
    : null
  const totalDebt = (budget?.calculations ?? []).reduce((s, r) => s + (r.debt ?? 0), 0)
  const totalOverpayment = (budget?.calculations ?? []).reduce((s, r) => s + (r.overpayment ?? 0), 0)

  const periodData = getPeriodRange(period)
  const filteredReports = tab === 'submitted' && !isMock
    ? filterByPeriod(reports, period) : reports

  // Stats for submitted tab
  const accepted   = filteredReports.filter(r => r.status === 'accepted').length
  const rejected   = filteredReports.filter(r => r.status === 'rejected').length
  const processing = filteredReports.filter(r => r.status === 'processing').length

  const tabBase = `/dashboard/client/${id}/reports`

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link href={`/dashboard/client/${id}`} className="text-sm text-gray-400 hover:text-gray-600 transition">
            ← Назад
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1.5">Звітність</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {client.name}{client.edrpou ? ` · ${client.edrpou}` : ''}
          </p>
        </div>
      </div>

      {/* Debt / Overpayment cards */}
      {budget && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className={`col-span-2 rounded-xl px-5 py-4 ${totalDebt > 0 ? 'bg-red-50 border border-red-100' : 'bg-gray-50 border border-gray-200'}`}>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
              Заборгованість на {budgetDate ?? 'сьогодні'}
            </p>
            <p className={`text-2xl font-bold tabular-nums ${totalDebt > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {totalDebt > 0 ? formatMoney(totalDebt) : 'Немає'}
            </p>
          </div>
          <div className={`col-span-2 rounded-xl px-5 py-4 ${totalOverpayment > 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-gray-50 border border-gray-200'}`}>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
              Переплата на {budgetDate ?? 'сьогодні'}
            </p>
            <p className={`text-2xl font-bold tabular-nums ${totalOverpayment > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
              {totalOverpayment > 0 ? formatMoney(totalOverpayment) : 'Немає'}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-0 -mb-px">
          {[
            { key: 'list',      label: 'По роках',     href: `${tabBase}?year=${year}&tab=list` },
            { key: 'submitted', label: 'Здані звіти',  href: `${tabBase}?tab=submitted&period=${period}` },
          ].map(t => (
            <Link
              key={t.key}
              href={t.href}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* ── Tab: По роках ── */}
      {tab === 'list' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5">
              {YEARS.map(y => (
                <Link key={y}
                  href={`${tabBase}?year=${y}&tab=list`}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    y === year
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
                  }`}
                >
                  {y}
                </Link>
              ))}
            </div>
            {!isMock && total > 0 && (
              <span className="text-sm text-gray-400">{total} звітів</span>
            )}
          </div>
          <ReportsTable reports={reports} total={total} hasToken={hasToken} isMock={isMock}
            tokenExpired={tokenExpired} debugError={debugError} clientId={id} year={year} />
        </div>
      )}

      {/* ── Tab: Здані звіти ── */}
      {tab === 'submitted' && (
        <div className="space-y-4">
          {/* Period selector + label */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1.5">
              {(['month', 'quarter', 'year'] as Period[]).map(p => (
                <Link key={p}
                  href={`${tabBase}?tab=submitted&period=${p}`}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    p === period
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
                  }`}
                >
                  {p === 'month' ? 'Місяць' : p === 'quarter' ? 'Квартал' : 'Рік'}
                </Link>
              ))}
            </div>
            <span className="text-sm font-medium text-gray-600">{periodData.label}</span>
          </div>

          {/* Stats row */}
          {!isMock && filteredReports.length > 0 && (
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Всього',     value: filteredReports.length, color: 'text-gray-800' },
                { label: 'Прийнято',   value: accepted,               color: 'text-emerald-600' },
                { label: 'В обробці',  value: processing,             color: 'text-blue-600'    },
                { label: 'Відхилено',  value: rejected,               color: 'text-red-600'     },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3 text-center">
                  <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          <ReportsTable reports={filteredReports} total={filteredReports.length}
            hasToken={hasToken} isMock={isMock} tokenExpired={tokenExpired}
            debugError={debugError} clientId={id} year={year}
            emptyLabel={`Звітів за ${periodData.label.toLowerCase()} не знайдено`}
            showFooter={false}
          />
        </div>
      )}
    </div>
  )
}

// ── Reports table component ───────────────────────────────────────────────────
function ReportsTable({
  reports, total, hasToken, isMock, tokenExpired, debugError,
  clientId, year, emptyLabel, showFooter = true,
}: {
  reports: TaxReport[]
  total: number
  hasToken: boolean
  isMock: boolean
  tokenExpired: boolean
  debugError?: string
  clientId: string
  year: number
  emptyLabel?: string
  showFooter?: boolean
}) {
  if (!hasToken) return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
      <p className="font-semibold mb-1">Потрібен токен доступу ДПС</p>
      <p>
        Додайте токен у{' '}
        <Link href={`/dashboard/client/${clientId}/settings`} className="underline font-medium">Налаштуваннях</Link>
        {' '}або відкрийте{' '}
        <a href="https://cabinet.tax.gov.ua" target="_blank" rel="noopener noreferrer" className="underline font-medium">cabinet.tax.gov.ua →</a>
      </p>
    </div>
  )

  if (isMock && tokenExpired) return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
      <p className="font-semibold mb-1">Токен застарів</p>
      <p>Оновіть у <Link href={`/dashboard/client/${clientId}/settings`} className="underline">Налаштуваннях</Link></p>
    </div>
  )

  if (isMock) return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 text-sm text-gray-700">
      <p className="font-semibold mb-1">⚠️ Не вдалося завантажити звітність</p>
      <p>Спробуйте пізніше або відкрийте{' '}
        <a href="https://cabinet.tax.gov.ua" target="_blank" rel="noopener noreferrer" className="underline">cabinet.tax.gov.ua →</a>
      </p>
      {debugError && <p className="mt-2 font-mono text-xs text-red-600 break-all">{debugError}</p>}
    </div>
  )

  if (reports.length === 0) return (
    <div className="bg-white rounded-xl border border-gray-200 px-6 py-14 text-center">
      <p className="text-3xl mb-3">📭</p>
      <p className="text-gray-500 text-sm">{emptyLabel ?? `Звітів за ${year} рік не знайдено`}</p>
    </div>
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b-2 border-gray-100">
            <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap w-32">
              Дата подачі
            </th>
            <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">
              Назва звіту
            </th>
            <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap w-28">
              Форма
            </th>
            <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap w-28">
              Період
            </th>
            <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap w-36">
              Рег. номер
            </th>
            <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap w-28">
              Статус
            </th>
          </tr>
        </thead>
        <tbody>
          {reports.map((rep, idx) => {
            const rowBg = rep.status === 'rejected'
              ? 'bg-red-50/40'
              : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'
            return (
              <tr key={rep.id}
                className={`border-b border-gray-100 last:border-0 hover:bg-blue-50/40 transition-colors ${rowBg}`}
              >
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap tabular-nums text-xs">
                  {formatDate(rep.submittedAt)}
                </td>
                <td className="px-4 py-3 text-gray-800 font-medium">
                  <span className="line-clamp-2 leading-snug">{rep.name || '—'}</span>
                </td>
                <td className="px-4 py-3">
                  {rep.formCode ? (
                    <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                      {rep.formCode}
                    </span>
                  ) : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">
                  {rep.period || '—'}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">
                  {rep.regNumber || '—'}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <StatusBadge status={rep.status} text={rep.statusText} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {showFooter && total > reports.length && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-400 text-center">
          Показано {reports.length} з {total}.{' '}
          <a href="https://cabinet.tax.gov.ua" target="_blank" rel="noopener noreferrer"
            className="underline hover:text-gray-600">Всі звіти у Кабінеті ДПС →</a>
        </div>
      )}
    </div>
  )
}
