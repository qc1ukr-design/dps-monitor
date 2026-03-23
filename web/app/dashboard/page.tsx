import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: clients } = await supabase
    .from('clients')
    .select('id, name, edrpou')
    .order('created_at', { ascending: false })
    .limit(5)

  const hasClients = clients && clients.length > 0

  const modules = [
    { icon: '🏢', title: 'Профіль платника', desc: 'Назва, ЄДРПОУ, статус', active: true },
    { icon: '💰', title: 'Розрахунки з бюджетом', desc: 'Борги, переплати, нарахування', active: true },
    { icon: '📋', title: 'Звітність', desc: 'Статуси поданих звітів', active: false },
    { icon: '📄', title: 'Документи', desc: 'Вхідні листи від ДПС', active: false },
    { icon: '🔔', title: 'Алерти', desc: 'Нові борги та повідомлення', active: false },
    { icon: '📊', title: 'Excel-звіт', desc: 'Зведений звіт по всіх клієнтах', active: false },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-gray-900">ДПС-Монітор</span>
          <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-medium">MVP</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/dashboard/clients" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            Контрагенти
          </Link>
          <span className="text-sm text-gray-500">{user.email}</span>
          <form action="/auth/signout" method="POST">
            <button className="text-sm text-gray-500 hover:text-gray-700">Вийти</button>
          </form>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Clients quick switcher */}
        {hasClients ? (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">Ваші контрагенти</h2>
              <Link href="/dashboard/clients" className="text-sm text-blue-600 hover:text-blue-800">
                Усі →
              </Link>
            </div>
            <div className="flex flex-wrap gap-3">
              {clients.map((c) => (
                <Link
                  key={c.id}
                  href={`/dashboard/client/${c.id}`}
                  className="bg-white border border-gray-200 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-900 hover:border-blue-400 hover:shadow-sm transition"
                >
                  {c.name}
                  {c.edrpou && <span className="text-gray-400 font-normal ml-2">{c.edrpou}</span>}
                </Link>
              ))}
              <Link
                href="/dashboard/clients/new"
                className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-sm font-medium text-blue-600 hover:bg-blue-100 transition"
              >
                + Додати
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
            <p className="text-gray-900 font-semibold text-lg mb-1">Додайте першого контрагента</p>
            <p className="text-gray-500 text-sm mb-5">Введіть назву клієнта і токен ДПС API щоб розпочати моніторинг</p>
            <Link
              href="/dashboard/clients/new"
              className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
            >
              Додати контрагента
            </Link>
          </div>
        )}

        {/* Modules grid */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Модулі</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {modules.map((m) => (
              <div
                key={m.title}
                className={`bg-white rounded-xl border p-5 ${m.active ? 'border-blue-200' : 'border-gray-200 opacity-60'}`}
              >
                <div className="text-2xl mb-3">{m.icon}</div>
                <h3 className="font-semibold text-gray-900">{m.title}</h3>
                <p className="text-sm text-gray-500 mt-1">{m.desc}</p>
                <span className={`mt-3 inline-block text-xs px-2 py-0.5 rounded font-medium ${
                  m.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {m.active ? 'Активний' : 'Незабаром'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
