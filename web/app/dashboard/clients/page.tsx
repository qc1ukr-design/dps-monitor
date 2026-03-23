import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import ClientDeleteButton from './client-delete-button'

export default async function ClientsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, edrpou, created_at')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })

  // Load KEP status and last sync for all clients in parallel
  const clientIds = clients?.map(c => c.id) ?? []

  const [tokenRows, cacheRows] = await Promise.all([
    clientIds.length
      ? supabase
          .from('api_tokens')
          .select('client_id, kep_ca_name, kep_owner_name, kep_tax_id')
          .in('client_id', clientIds)
          .eq('user_id', user!.id)
      : { data: [] },
    clientIds.length
      ? supabase
          .from('dps_cache')
          .select('client_id, fetched_at, is_mock')
          .in('client_id', clientIds)
          .eq('user_id', user!.id)
          .order('fetched_at', { ascending: false })
      : { data: [] },
  ])

  const kepMap = new Map(
    (tokenRows.data ?? []).map(t => [t.client_id, t])
  )

  // Latest sync per client
  const syncMap = new Map<string, string>()
  for (const row of (cacheRows.data ?? [])) {
    if (!syncMap.has(row.client_id)) {
      syncMap.set(row.client_id, row.fetched_at)
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Контрагенти</h1>
          <p className="text-gray-500 text-sm mt-1">
            {clients?.length
              ? `${clients.length} клієнт${clients.length === 1 ? '' : clients.length < 5 ? 'и' : 'ів'}`
              : 'Ваші клієнти, підключені до ДПС'}
          </p>
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
          {clients.map((client) => {
            const kep = kepMap.get(client.id)
            const kepConnected = !!kep?.kep_ca_name
            const lastSync = syncMap.get(client.id)

            return (
              <li key={client.id} className="group flex items-center gap-2">
                <Link
                  href={`/dashboard/client/${client.id}`}
                  className="flex-1 flex items-center justify-between bg-white rounded-xl border border-gray-200 px-6 py-4 hover:border-blue-300 hover:shadow-sm transition"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-gray-900 truncate">{client.name}</p>
                      {kepConnected ? (
                        <span className="shrink-0 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                          KEP ✓
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                          Без KEP
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-500">
                      {(kep?.kep_tax_id || client.edrpou) && (
                        <span>РНОКПП/ЄДРПОУ: {kep?.kep_tax_id || client.edrpou}</span>
                      )}
                      {lastSync && (
                        <span className="text-gray-400">
                          · оновлено {new Date(lastSync).toLocaleDateString('uk-UA')}
                        </span>
                      )}
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition shrink-0 ml-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
                <ClientDeleteButton clientId={client.id} clientName={client.name} />
              </li>
            )
          })}
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
