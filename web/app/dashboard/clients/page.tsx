import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function ClientsPage() {
  const supabase = await createClient()
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, edrpou, created_at')
    .order('created_at', { ascending: false })

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Контрагенти</h1>
          <p className="text-gray-500 text-sm mt-1">Ваші клієнти, підключені до ДПС API</p>
        </div>
        <Link
          href="/dashboard/clients/new"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          + Додати клієнта
        </Link>
      </div>

      {!clients || clients.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-dashed border-gray-300">
          <p className="text-gray-400 text-lg mb-2">Немає контрагентів</p>
          <p className="text-gray-400 text-sm mb-6">Додайте першого клієнта щоб розпочати моніторинг</p>
          <Link
            href="/dashboard/clients/new"
            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
          >
            Додати клієнта
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {clients.map((client) => (
            <li key={client.id}>
              <Link
                href={`/dashboard/client/${client.id}`}
                className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-6 py-4 hover:border-blue-300 hover:shadow-sm transition"
              >
                <div>
                  <p className="font-semibold text-gray-900">{client.name}</p>
                  {client.edrpou && (
                    <p className="text-sm text-gray-500">ЄДРПОУ: {client.edrpou}</p>
                  )}
                </div>
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600">
          ← Назад до дашборду
        </Link>
      </div>
    </div>
  )
}
