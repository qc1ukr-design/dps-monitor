import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import TaxpayerProfileCard from '@/components/taxpayer-profile'
import BudgetCalculationsTable from '@/components/budget-calculations'
import { fetchProfile, fetchBudget } from '@/lib/dps/fetcher'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ClientPage({ params }: PageProps) {
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

  const [profileRes, budgetRes] = await Promise.all([
    fetchProfile(id, user.id),
    fetchBudget(id, user.id),
  ])

  return (
    <div className="max-w-4xl mx-auto py-10 px-4 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/dashboard/clients" className="text-sm text-gray-400 hover:text-gray-600">
            ← Контрагенти
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">{client.name}</h1>
          {client.edrpou && (
            <p className="text-gray-500 text-sm">ЄДРПОУ: {client.edrpou}</p>
          )}
        </div>
        <Link
          href={`/dashboard/client/${id}/settings`}
          className="text-sm text-gray-400 hover:text-gray-600 mt-1"
        >
          ⚙ Налаштування
        </Link>
      </div>

      <TaxpayerProfileCard profile={profileRes.data!} isMock={profileRes.isMock} />
      <BudgetCalculationsTable data={budgetRes.data!} isMock={budgetRes.isMock} />
    </div>
  )
}
