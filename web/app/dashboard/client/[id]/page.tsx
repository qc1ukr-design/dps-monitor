import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import TaxpayerProfileCard from '@/components/taxpayer-profile'
import BudgetCalculationsTable from '@/components/budget-calculations'
import { MOCK_PROFILE, MOCK_BUDGET } from '@/lib/dps/mock-data'
import type { TaxpayerProfile, BudgetCalculations } from '@/lib/dps/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ClientPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: client, error } = await supabase
    .from('clients')
    .select('id, name, edrpou')
    .eq('id', id)
    .single()

  if (error || !client) notFound()

  // Запитуємо дані через наш proxy (або mock якщо DPS недоступний)
  let profile: TaxpayerProfile = MOCK_PROFILE
  let budget: BudgetCalculations = MOCK_BUDGET
  let isMock = true

  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const [profileRes, budgetRes] = await Promise.all([
      fetch(`${baseUrl}/api/dps/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: id, endpoint: 'profile' }),
        cache: 'no-store',
      }),
      fetch(`${baseUrl}/api/dps/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: id, endpoint: 'budget' }),
        cache: 'no-store',
      }),
    ])

    if (profileRes.ok) {
      const json = await profileRes.json()
      profile = json.data ?? MOCK_PROFILE
      isMock = json.isMock ?? true
    }

    if (budgetRes.ok) {
      const json = await budgetRes.json()
      budget = json.data ?? MOCK_BUDGET
    }
  } catch {
    // fallback to mock
  }

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
      </div>

      <TaxpayerProfileCard profile={profile} isMock={isMock} />
      <BudgetCalculationsTable data={budget} isMock={isMock} />
    </div>
  )
}
