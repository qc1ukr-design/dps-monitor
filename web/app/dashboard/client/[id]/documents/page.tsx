import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { decrypt } from '@/lib/crypto'
import { normalizeDocuments } from '@/lib/dps/normalizer'
import { MOCK_DOCUMENTS } from '@/lib/dps/mock-data'
import type { DocumentsList, IncomingDocument } from '@/lib/dps/types'

interface PageProps {
  params: Promise<{ id: string }>
}

async function fetchDocuments(
  clientId: string,
  userId: string
): Promise<DocumentsList & { noToken: boolean; isMock: boolean }> {
  const supabase = await createClient()

  const { data: tokenRow } = await supabase
    .from('api_tokens')
    .select('token_encrypted')
    .eq('client_id', clientId)
    .eq('user_id', userId)
    .single()

  if (!tokenRow?.token_encrypted) {
    return { ...MOCK_DOCUMENTS, noToken: true, isMock: true }
  }

  let token: string
  try {
    token = decrypt(tokenRow.token_encrypted).trim()
  } catch {
    return { ...MOCK_DOCUMENTS, noToken: false, isMock: true }
  }

  try {
    const res = await fetch(
      'https://cabinet.tax.gov.ua/ws/a/corr/correspondence?page=0&limit=50',
      {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
        cache: 'no-store',
      }
    )
    if (res.ok) {
      const raw = await res.json()
      const normalized = normalizeDocuments(raw)
      return { ...normalized, noToken: false, isMock: false }
    }
  } catch {
    /* fallback to mock */
  }

  return { ...MOCK_DOCUMENTS, noToken: false, isMock: true }
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
  return d.toLocaleDateString('uk-UA')
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

  const { documents, total, noToken, isMock } = await fetchDocuments(id, user.id)

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
          <div className="flex items-center gap-2">
            {!isMock && (
              <span className="text-sm text-gray-500">
                Всього: {total}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* No-token notice */}
      {noToken && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">📋 Токен ДПС не налаштовано</p>
          <p>
            Для перегляду вхідних документів потрібен UUID-токен з розділу{' '}
            <strong>«Відкриті дані»</strong> в електронному кабінеті. Додайте його у{' '}
            <Link href={`/dashboard/client/${id}/settings`} className="underline font-medium hover:text-amber-900">
              Налаштуваннях
            </Link>
            {' '}або відкрийте документи напряму в{' '}
            <a href="https://cabinet.tax.gov.ua" target="_blank" rel="noopener noreferrer"
              className="underline font-medium hover:text-amber-900">
              Електронному кабінеті ДПС →
            </a>
          </p>
        </div>
      )}

      {/* Has token but fetch failed */}
      {!noToken && isMock && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4 text-sm text-gray-700">
          <p className="font-semibold mb-1">⚠️ Не вдалося завантажити документи</p>
          <p>
            ДПС кабінет тимчасово недоступний або токен застарів. Спробуйте пізніше або{' '}
            <a href="https://cabinet.tax.gov.ua" target="_blank" rel="noopener noreferrer"
              className="underline font-medium hover:text-gray-900">
              відкрийте кабінет ДПС напряму →
            </a>
          </p>
        </div>
      )}

      {/* Documents table — only show real data */}
      {!isMock && documents.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-6 py-12 text-center">
          <p className="text-gray-500 text-sm">Вхідних документів не знайдено</p>
        </div>
      )}

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
        </div>
      )}
    </div>
  )
}

