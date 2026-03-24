import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { alertIcon } from '@/lib/dps/alerts'
import type { AlertType } from '@/lib/dps/alerts'
import MarkReadButton from './mark-read-button'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default async function AlertsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: alerts } = await supabase
    .from('alerts')
    .select('id, type, message, is_read, created_at, client_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  const unreadCount = alerts?.filter(a => !a.is_read).length ?? 0
  const list = alerts ?? []

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🔔 Алерти</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {unreadCount > 0
              ? `${unreadCount} непрочитаних`
              : 'Всі прочитано'}
          </p>
        </div>
        {unreadCount > 0 && <MarkReadButton />}
      </div>

      {/* Empty state */}
      {list.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 px-8 py-14 text-center">
          <p className="text-4xl mb-3">🔔</p>
          <p className="font-semibold text-gray-700">Алертів поки немає</p>
          <p className="text-sm text-gray-400 mt-1">
            {`Вони з'являться після першої нічної синхронізації`}
          </p>
        </div>
      )}

      {/* Alerts list */}
      {list.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {list.map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start gap-4 px-5 py-4 transition-colors ${
                !alert.is_read ? 'bg-blue-50/40' : ''
              }`}
            >
              {/* Icon */}
              <span className="text-2xl flex-shrink-0 mt-0.5">
                {alertIcon(alert.type as AlertType)}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${!alert.is_read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  {alert.message}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {formatDate(alert.created_at)}
                </p>
              </div>

              {/* Link to client */}
              <Link
                href={`/dashboard/client/${alert.client_id}`}
                className="flex-shrink-0 text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap"
              >
                Переглянути →
              </Link>

              {/* Unread dot */}
              {!alert.is_read && (
                <span className="flex-shrink-0 w-2 h-2 rounded-full bg-blue-500 mt-2" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
