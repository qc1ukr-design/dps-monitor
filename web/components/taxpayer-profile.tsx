'use client'

import type { TaxpayerProfile } from '@/lib/dps/types'

interface Props {
  profile: TaxpayerProfile
  isMock?: boolean
}

const simpleRows: { label: string; key: keyof TaxpayerProfile }[] = [
  { label: 'Назва / ПІБ', key: 'name' },
  { label: 'ЄДРПОУ', key: 'edrpou' },
  { label: 'РНОКПП', key: 'rnokpp' },
  { label: 'Податковий статус', key: 'status' },
  { label: 'Дата реєстрації', key: 'registrationDate' },
  { label: 'Контролюючий орган', key: 'taxAuthority' },
  { label: 'Система оподаткування', key: 'accountingType' },
  { label: 'Адреса', key: 'address' },
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
        {simpleRows.map(({ label, key }) => {
          const value = profile[key]
          if (!value) return null
          return (
            <div key={key} className="px-6 py-3 flex gap-4">
              <dt className="w-52 shrink-0 text-sm text-gray-500">{label}</dt>
              <dd className="text-sm font-medium text-gray-900">{String(value)}</dd>
            </div>
          )
        })}

        {profile.kvedList && profile.kvedList.length > 0 && (
          <div className="px-6 py-3 flex gap-4">
            <dt className="w-52 shrink-0 text-sm text-gray-500 pt-0.5">КВЕДи</dt>
            <dd className="flex-1">
              <ul className="space-y-1">
                {profile.kvedList.map((kved, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                      {kved.code}
                    </span>
                    <span className="text-sm text-gray-900">{kved.name}</span>
                    {kved.isPrimary && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                        основний
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}
