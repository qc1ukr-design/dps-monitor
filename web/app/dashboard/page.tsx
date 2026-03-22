import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-gray-900">ДПС-Монітор</span>
          <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-medium">MVP</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user.email}</span>
          <form action="/auth/signout" method="POST">
            <button className="text-sm text-gray-500 hover:text-gray-700">Вийти</button>
          </form>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Дашборд</h2>
          <p className="text-gray-500 mt-1">Ласкаво просимо! Додайте першого контрагента щоб почати.</p>
        </div>

        {/* Modules grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: '🏢', title: 'Профіль платника', desc: 'Назва, ЄДРПОУ, статус', status: 'soon' },
            { icon: '💰', title: 'Розрахунки з бюджетом', desc: 'Борги, переплати, нарахування', status: 'soon' },
            { icon: '📋', title: 'Звітність', desc: 'Статуси поданих звітів', status: 'soon' },
            { icon: '📄', title: 'Документи', desc: 'Вхідні листи від ДПС', status: 'soon' },
            { icon: '🔔', title: 'Алерти', desc: 'Нові борги та повідомлення', status: 'soon' },
            { icon: '📊', title: 'Excel-звіт', desc: 'Зведений звіт по всіх клієнтах', status: 'soon' },
          ].map(m => (
            <div key={m.title} className="bg-white rounded-xl border border-gray-200 p-5 opacity-60">
              <div className="text-2xl mb-3">{m.icon}</div>
              <h3 className="font-semibold text-gray-900">{m.title}</h3>
              <p className="text-sm text-gray-500 mt-1">{m.desc}</p>
              <span className="mt-3 inline-block text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                Незабаром
              </span>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
