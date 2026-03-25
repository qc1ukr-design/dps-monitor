import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { decrypt } from '@/lib/crypto'
import { loginWithKep } from '@/lib/dps/dps-auth'
import { normalizeReports } from '@/lib/dps/normalizer'
import type { ReportsList, TaxReport } from '@/lib/dps/types'

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ year?: string }>
}

const DPS_API = 'https://cabinet.tax.gov.ua/ws/api'

async function fetchReports(
  clientId: string,
  userId: string,
  year: number
): Promise<ReportsList & { noKep: boolean; isMock: boolean; debugError?: string }> {
  const supabase = await createClient()

  const { data: tokenRow } = await supabase
    .from('api_tokens')
    .select('kep_encrypted, kep_password_encrypted, kep_tax_id')
    .eq('client_id', clientId)
    .eq('user_id', userId)
    .single()

  if (!tokenRow?.kep_encrypted || !tokenRow?.kep_password_encrypted) {
    return { reports: [], total: 0, noKep: true, isMock: true }
  }

  try {
    const kepDecrypted = decrypt(tokenRow.kep_encrypted)
    const password = decrypt(tokenRow.kep_password_encrypted)
    const taxId = (tokenRow.kep_tax_id ?? '').trim()

    const { accessToken } = await loginWithKep(kepDecrypted, password, taxId)

    const res = await fetch(
      `${DPS_API}/regdoc/list?periodYear=${year}&page=0&size=50&sort=dget,desc`,
      {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      }
    )

    if (res.ok) {
      const raw = await res.json()
      const normalized = normalizeReports(raw)
      return { ...normalized, noKep: false, isMock: false }
    }
    const errText = await res.text().catch(() => '')
    return { reports: [], total: 0, noKep: false, isMock: true, debugError: `regdoc ${res.status}: ${errText.slice(0, 300)}` }
  } catch (e) {
    return { reports: [], total: 0, noKep: false, isMock: true, debugError: String(e).slice(0, 300) }
  }
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

const YEARS = [2026, 2025, 2024, 2023]

export default async function ReportsPage({ params, searchParams }: PageProps) {
  const { id } = await params
  const { year: yearParam } = await searchParams
  const year = Number(yearParam) || new Date().getFullYear()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: client, error } = await supabase
    .from('clients')
    .select('id, name, edrpou')
    .eq('id', id)
    .single()
  if (error || !client) notFound()

  const { reports, total, noKep, isMock, debugError } = await fetchReports(id, user.id, year)

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

      {/* No KEP notice */}
      {noKep && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">🔑 КЕП не налаштовано</p>
          <p>
            Для перегляду звітності потрібен електронний підпис (КЕП). Додайте його у{' '}
            <Link href={`/dashboard/client/${id}/settings`} className="underline font-medium hover:text-amber-900">
              Налаштуваннях
            </Link>
            {' '}або перевірте звітність напряму в{' '}
            <a href="https://cabinet.tax.gov.ua" target="_blank" rel="noopener noreferrer"
              className="underline font-medium hover:text-amber-900">
              Електронному кабінеті ДПС →
            </a>
          </p>
        </div>
      )}

      {/* Has KEP but fetch failed */}
      {!noKep && isMock && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 text-sm text-gray-700">
          <p className="font-semibold mb-1">⚠️ Не вдалося завантажити звітність</p>
          <p>
            ДПС кабінет тимчасово недоступний або КЕП застарів. Спробуйте пізніше або{' '}
            <a href="https://cabinet.tax.gov.ua" target="_blank" rel="noopener noreferrer"
              className="underline font-medium hover:text-gray-900">
              відкрийте кабінет ДПС напряму →
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

      {/* Reports table — only real data */}
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
        </div>
      )}
    </div>
  )
}
