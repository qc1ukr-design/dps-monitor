'use client'

import type { TaxpayerProfile } from '@/lib/dps/types'

interface Props {
  profile: TaxpayerProfile
  isMock?: boolean
}

const rows: { label: string; key: keyof TaxpayerProfile }[] = [
  { label: 'Назва / ПІБ', key: 'name' },
  { label: 'ЄДРПОУ', key: 'edrpou' },
  { label: 'РНОКПП', key: 'rnokpp' },
  { label: 'Податковий статус', key: 'status' },
  { label: 'Дата реєстрації', key: 'registrationDate' },
  { label: 'Контролюючий орган', key: 'taxAuthority' },
  { label: 'Система оподаткування', key: 'accountingType' },
]

export default function TaxpayerProfileCard({ profile, isMock }: Props) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Профіль платника</h2>
        {isMock && (
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
            Demo-дані
          </span>
        )}
      </div>
      <dl className="divide-y divide-gray-100">
        {rows.map(({ label, key }) => {
          const value = profile[key]
          if (!value) return null
          return (
            <div key={key} className="px-6 py-3 flex gap-4">
              <dt className="w-52 shrink-0 text-sm text-gray-500">{label}</dt>
              <dd className="text-sm font-medium text-gray-900">{value}</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
