import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { decrypt } from '@/lib/crypto'
import { signWithKepDecrypted } from '@/lib/dps/signer'
import { normalizeReports } from '@/lib/dps/normalizer'
import type { ReportsList, TaxReport } from '@/lib/dps/types'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ year?: string }>
}

const DPS_API  = 'https://cabinet.tax.gov.ua/ws/api'
const DPS_A    = 'https://cabinet.tax.gov.ua/ws/a'

async function probe(url: string, auth: string): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: auth, Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    })
    const body = (await res.text().catch(() => '')).slice(0, 120)
    return { ok: res.ok, status: res.status, body }
  } catch (e) {
    return { ok: false, status: 0, body: String(e).slice(0, 80) }
  }
}

async function fetchReports(
  clientId: string,
  userId: string,
  year: number
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

  const url1 = `${DPS_API}/regdoc/list?periodYear=${year}&page=0&size=50&sort=dget,desc`
  const url2 = `${DPS_A}/regdoc/list?periodYear=${year}&page=0&size=50&sort=dget,desc`

  // ── Try KEP Bearer directly on ws/api and ws/a (no OAuth) ─────────────────
  if (hasKep) {
    try {
      const kepDecrypted = decrypt(tokenRow!.kep_encrypted)
      const kepPass      = decrypt(tokenRow!.kep_password_encrypted)
      const taxId        = (tokenRow!.kep_tax_id ?? '').trim()
      const kepAuth      = await signWithKepDecrypted(kepDecrypted, kepPass, taxId)

      const attempts = [
        { url: url1, auth: kepAuth,            label: 'ws/api raw' },
        { url: url1, auth: `Bearer ${kepAuth}`, label: 'ws/api bearer' },
        { url: url2, auth: kepAuth,            label: 'ws/a raw' },
        { url: url2, auth: `Bearer ${kepAuth}`, label: 'ws/a bearer' },
      ]

      const results: string[] = []
      for (const { url, auth, label } of attempts) {
        const r = await probe(url, auth)
        if (r.ok) {
          const raw = JSON.parse(r.body.length < 120 ? r.body : (await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' }, cache: 'no-store' }).then(x => x.text())))
          return { ...normalizeReports(raw), hasToken: true, isMock: false, tokenExpired: false }
        }
        results.push(`${label}→${r.status}`)
      }
      var kepDebug = results.join(' ')
    } catch (e) {
      var kepDebug = `KEP sign error: ${String(e).slice(0, 100)}`
    }
  }

  // ── Fallback: UUID Bearer token via ws/a ────────────────────────────────────
  if (hasUuid) {
    try {
      const token = decrypt(tokenRow!.token_encrypted).trim()
      const res = await fetch(url2, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      })
      if (res.ok) {
        const raw = await res.json()
        return { ...normalizeReports(raw), hasToken: true, isMock: false, tokenExpired: false }
      }
      var uuidDebug = `UUID→${res.status}`
    } catch (e) {
      var uuidDebug = `UUID err: ${String(e).slice(0, 80)}`
    }
  }

  const debugError = [kepDebug, uuidDebug].filter(Boolean).join(' | ')
  return { reports: [], total: 0, hasToken: true, isMock: true, tokenExpired: false, debugError }
}

function statusBadge(status: TaxReport['status'], text: string) {
  const map: Record<TaxReport['status'], string> = {
    accepted:   'bg-green-100 text-green-700',
    rejected:   'bg-red-100 text-red-700',
    processing: 'bg-blue-100 text-blue-700',
    pending:    'bg-gray-100 text-gray-500',
  }
  const labels: Record<TaxReport['status'], string> = {
    accepted:   'Прийнято',
    rejected:   'Відхилено',
    processing: 'В обробці',
    pending:    'Очікує',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status]}`}>
      {text || labels[status]}
    </span>
  )
}

function formatDate(s: string) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kiev' })
}

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 4 }, (_, i) => CURRENT_YEAR - i)

export default async function ReportsPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const { year: yearParam } = await searchParams
  const year = Number(yearParam) || CURRENT_YEAR

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: client, error } = await supabase
    .from('clients')
    .select('id, name, edrpou')
    .eq('id', id)
    .single()
  if (error || !client) notFound()

  const { reports, total, hasToken, isMock, tokenExpired, debugError } = await fetchReports(id, user.id, year)

  return (
    <div className="max-w-5xl mx-auto py-10 px-4 space-y-6">

      {/* Header */}
      <div>
        <Link href={`/dashboard/client/${id}`} className="text-sm text-gray-400 hover:text-gray-600">
          ← Назад
        </Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">📋 Звітність</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {client.name}{client.edrpou ? ` · ЄДРПОУ: ${client.edrpou}` : ''}
            </p>
          </div>
          {/* Year selector */}
          <div className="flex items-center gap-2">
            {!isMock && total > 0 && (
              <span className="text-sm text-gray-500 mr-2">Всього: {total}</span>
            )}
            <div className="flex gap-1">
              {YEARS.map(y => (
                <Link
                  key={y}
                  href={`/dashboard/client/${id}/reports?year=${y}`}
                  className={`px-3 py-1.5 text-sm rounded-lg font-medium transition ${
                    y === year
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'
                  }`}
                >
                  {y}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* No token */}
      {!hasToken && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Потрібен токен доступу ДПС</p>
          <p>
            Для перегляду звітності додайте токен сесії у{' '}
            <Link href={`/dashboard/client/${id}/settings`} className="underline font-medium hover:text-amber-900">
              Налаштуваннях
            </Link>
            {' '}або перегляньте звітність напряму у{' '}
            <a href="https://cabinet.tax.gov.ua" target="_blank" rel="noopener noreferrer"
              className="underline font-medium hover:text-amber-900">
              Електронному кабінеті ДПС →
            </a>
          </p>
        </div>
      )}

      {/* Token expired */}
      {hasToken && isMock && tokenExpired && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Токен доступу застарів</p>
          <p>
            Токен ДПС дійсний лише кілька годин. Оновіть його у{' '}
            <Link href={`/dashboard/client/${id}/settings`} className="underline font-medium hover:text-amber-900">
              Налаштуваннях
            </Link>
            {' '}або відкрийте кабінет ДПС напряму:{' '}
            <a href="https://cabinet.tax.gov.ua" target="_blank" rel="noopener noreferrer"
              className="underline font-medium hover:text-amber-900">
              cabinet.tax.gov.ua →
            </a>
          </p>
        </div>
      )}

      {/* Generic fetch error (network issue etc) */}
      {hasToken && isMock && !tokenExpired && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 text-sm text-gray-700">
          <p className="font-semibold mb-1">⚠️ Не вдалося завантажити звітність</p>
          <p>
            Спробуйте пізніше або відкрийте кабінет ДПС напряму:{' '}
            <a href="https://cabinet.tax.gov.ua" target="_blank" rel="noopener noreferrer"
              className="underline font-medium hover:text-gray-900">
              cabinet.tax.gov.ua →
            </a>
          </p>
          {debugError && (
            <p className="mt-2 font-mono text-xs text-red-600 break-all">{debugError}</p>
          )}
        </div>
      )}

      {/* Empty state */}
      {!isMock && reports.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center">
          <p className="text-gray-500 text-sm">Звітів за {year} рік не знайдено</p>
        </div>
      )}

      {/* Reports table */}
      {!isMock && reports.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Дата подачі</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Назва звіту</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Форма</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Період</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Рег. номер</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 whitespace-nowrap">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reports.map((rep) => (
                <tr key={rep.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {formatDate(rep.submittedAt)}
                  </td>
                  <td className="px-4 py-3 text-gray-800">
                    <span className="line-clamp-2">{rep.name || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">
                    {rep.formCode || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {rep.period || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">
                    {rep.regNumber || '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {statusBadge(rep.status, rep.statusText)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > reports.length && (
            <div className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100 text-center">
              Показано {reports.length} з {total} звітів. Відкрийте{' '}
              <a href="https://cabinet.tax.gov.ua" target="_blank" rel="noopener noreferrer"
                className="underline hover:text-gray-600">
                Кабінет ДПС
              </a>{' '}
              для перегляду всіх.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
