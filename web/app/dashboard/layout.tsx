import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition">
            <span className="text-lg font-bold text-gray-900">ДПС-Монітор</span>
            <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-medium">MVP</span>
          </Link>
          <span className="text-gray-300">|</span>
          <Link href="/dashboard/clients" className="text-sm text-gray-500 hover:text-gray-800 transition">
            Контрагенти
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400 hidden sm:block">{user.email}</span>
          <form action="/auth/signout" method="POST">
            <button className="text-sm text-gray-500 hover:text-gray-700 transition">Вийти</button>
          </form>
        </div>
      </header>
      <main>
        {children}
      </main>
    </div>
  )
}
