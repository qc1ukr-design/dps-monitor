'use client'

import type { BudgetCalculations } from '@/lib/dps/types'

interface Props {
  data: BudgetCalculations
  isMock?: boolean
}

function fmt(n: number) {
  return new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH', maximumFractionDigits: 0 }).format(n)
}

export default function BudgetCalculationsTable({ data, isMock }: Props) {
  const hasDebt = data.calculations.some((r) => r.debt > 0)

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Розрахунки з бюджетом</h2>
          {hasDebt && (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-medium">
              ! Є борг
            </span>
          )}
        </div>
        {isMock && (
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium">
            Demo-дані
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <th className="px-6 py-3 text-left">Податок</th>
              <th className="px-6 py-3 text-right">Нараховано</th>
              <th className="px-6 py-3 text-right">Сплачено</th>
              <th className="px-6 py-3 text-right">Борг</th>
              <th className="px-6 py-3 text-right">Переплата</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.calculations.map((row) => (
              <tr
                key={row.taxCode}
                className={row.debt > 0 ? 'bg-red-50' : undefined}
              >
                <td className="px-6 py-3">
                  <p className="font-medium text-gray-900">{row.taxName}</p>
                  <p className="text-xs text-gray-400">{row.taxCode}</p>
                </td>
                <td className="px-6 py-3 text-right text-gray-700">{fmt(row.charged)}</td>
                <td className="px-6 py-3 text-right text-gray-700">{fmt(row.paid)}</td>
                <td className={`px-6 py-3 text-right font-semibold ${row.debt > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {row.debt > 0 ? fmt(row.debt) : '—'}
                </td>
                <td className={`px-6 py-3 text-right font-semibold ${row.overpayment > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                  {row.overpayment > 0 ? fmt(row.overpayment) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
