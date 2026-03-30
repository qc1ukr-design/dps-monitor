import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { decrypt } from '@/lib/crypto'
import { signWithKepDecrypted } from '@/lib/dps/signer'
import { normalizeDocuments } from '@/lib/dps/normalizer'
import type { DocumentsList, IncomingDocument } from '@/lib/dps/types'

interface PageProps {
  params: Promise<{ id: string }>
}

const DPS_PUBLIC = 'https://cabinet.tax.gov.ua/ws/public_api'
const DPS_A      = 'https://cabinet.tax.gov.ua/ws/a'

async function fetchDocuments(
  clientId: string,
  userId: string
): Promise<DocumentsList & { hasToken: boolean; isMock: boolean; tokenExpired: boolean; debugError?: string }> {
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
    return { documents: [], total: 0, hasToken: false, isMock: true, tokenExpired: false }
  }

  const opts = { Accept: 'application/json' }
  let kepDebug = '', uuidDebug = ''

  // ── KEP: ws/public_api/post/incoming (direct KEP Bearer) ──────────────────
  if (hasKep) {
    try {
      const kepDecrypted = decrypt(tokenRow!.kep_encrypted)
      const kepPass      = decrypt(tokenRow!.kep_password_encrypted)
      const taxId        = (tokenRow!.kep_tax_id ?? '').trim()
      const kepAuth      = await signWithKepDecrypted(kepDecrypted, kepPass, taxId)

      const res = await fetch(`${DPS_PUBLIC}/post/incoming?page=0&size=50`, {
        headers: { Authorization: kepAuth, ...opts },
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      })
      const rawText = await res.text()
      console.log(`[documents] post/incoming status=${res.status} taxId=${taxId} body=${rawText.slice(0, 400)}`)
      if (res.ok) {
        let rawJson: unknown = null
        try { rawJson = JSON.parse(rawText) } catch { /* not JSON */ }
        if (rawJson !== null) return { ...normalizeDocuments(rawJson), hasToken: true, isMock: false, tokenExpired: false }
        kepDebug = `kep→200 non-JSON: ${rawText.slice(0, 80)}`
      } else {
        kepDebug = `kep→${res.status}: ${rawText.slice(0, 80)}`
      }
    } catch (e) {
      kepDebug = `kep→${String(e).slice(0, 100)}`
    }
  }

  // ── Fallback: UUID Bearer token via ws/a ────────────────────────────────────
  if (hasUuid) {
    try {
      const token = decrypt(tokenRow!.token_encrypted).trim()
      const res = await fetch(`${DPS_A}/corr/correspondence?page=0&size=50`, {
        headers: { Authorization: `Bearer ${token}`, ...opts },
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      })
      if (res.ok) {
        const raw = await res.json()
        return { ...normalizeDocuments(raw), hasToken: true, isMock: false, tokenExpired: false }
      }
      const body = await res.text().catch(() => '')
      uuidDebug = `uuid→${res.status}${body ? ': ' + body.slice(0, 80) : ''}`
    } catch (e) {
      uuidDebug = `uuid→${String(e).slice(0, 80)}`
    }
  }

  const debugError = [kepDebug, uuidDebug].filter(Boolean).join(' | ')
  return { documents: [], total: 0, hasToken: true, isMock: true, tokenExpired: false, debugError }
}

function statusBadge(status: IncomingDocument['status']) {
  if (status === 'new') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
        Новий
      </span>
    )
  }
  if (status === 'read') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
        Прочитано
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
      Відповідь
    </span>
  )
}

function formatDate(dateStr: string) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('uk-UA', { timeZone: 'Europe/Kiev' })
}

export default async function DocumentsPage({ params }: PageProps) {
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

  const { documents, total, hasToken, isMock, tokenExpired, debugError } = await fetchDocuments(id, user.id)

  return (
    <div className="max-w-5xl mx-auto py-10 px-4 space-y-6">
      {/* Header */}
      <div>
        <Link href={`/dashboard/client/${id}`} className="text-sm text-gray-400 hover:text-gray-600">
          ← Назад
        </Link>
        <div className="flex items-center justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Вхідна документація</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {client.name}{client.edrpou ? ` · ЄДРПОУ: ${client.edrpou}` : ''}
            </p>
          </div>
          {!isMock && (
            <span className="text-sm text-gray-500">Всього: {total}</span>
          )}
        </div>
      </div>

      {/* No token */}
      {!hasToken && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Потрібен токен доступу ДПС</p>
          <p>
            Для перегляду документів додайте токен сесії у{' '}
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

      {/* Generic fetch error */}
      {hasToken && isMock && !tokenExpired && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 text-sm text-gray-700">
          <p className="font-semibold mb-1">⚠️ Не вдалося завантажити документи</p>
          <p>
            Спробуйте пізніше або відкрийте кабінет ДПС напряму:{' '}
            <a href="https://cabinet.tax.gov.ua" target="_blank" rel="noopener noreferrer"
              className="underline font-medium hover:text-gray-900">
              cabinet.tax.gov.ua →
            </a>
          </p>
          {debugError && <p className="mt-2 font-mono text-xs text-red-600 break-all">{debugError}</p>}
        </div>
      )}

      {/* Empty state */}
      {!isMock && documents.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center">
          <p className="text-gray-500 text-sm">Вхідних документів не знайдено</p>
        </div>
      )}

      {/* Documents table */}
      {!isMock && documents.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Дата</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Номер</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Тип</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Тема</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Від кого</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {formatDate(doc.date)}
                  </td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap font-mono text-xs">
                    {doc.number || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {doc.type || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-800">
                    <span className="line-clamp-2">{doc.subject || '—'}</span>
                    {doc.hasAttachments && (
                      <span className="text-xs text-gray-400 ml-1">📎</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {doc.fromOrg || '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {statusBadge(doc.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > documents.length && (
            <div className="px-4 py-3 text-xs text-gray-400 border-t border-gray-100 text-center">
              Показано {documents.length} з {total} документів. Відкрийте{' '}
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
