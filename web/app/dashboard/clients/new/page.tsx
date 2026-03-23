'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NewClientPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [edrpou, setEdrpou] = useState('')
  const [dpsToken, setDpsToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, edrpou: edrpou || undefined, dpsToken }),
    })

    setLoading(false)

    if (!res.ok) {
      const json = await res.json()
      setError(json.error || 'Помилка збереження')
      return
    }

    const { id } = await res.json()
    router.push(`/dashboard/client/${id}`)
  }

  return (
    <div className="max-w-lg mx-auto py-10 px-4">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Новий контрагент</h1>
        <p className="text-gray-500 text-sm mt-1">Введіть назву і токен доступу до ДПС API</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Назва / ПІБ <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ТОВ «Назва компанії»"
            required
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            ЄДРПОУ / РНОКПП
          </label>
          <input
            type="text"
            value={edrpou}
            onChange={(e) => setEdrpou(e.target.value)}
            placeholder="12345678"
            maxLength={10}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Токен ДПС API <span className="text-red-500">*</span>
          </label>
          <textarea
            value={dpsToken}
            onChange={(e) => setDpsToken(e.target.value)}
            placeholder="Вставте токен з Електронного кабінету ДПС..."
            required
            rows={4}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">
            Токен зберігається зашифровано і ніколи не передається на фронтенд
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition"
          >
            {loading ? 'Збереження...' : 'Додати контрагента'}
          </button>
          <Link
            href="/dashboard/clients"
            className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-50 transition"
          >
            Скасувати
          </Link>
        </div>
      </form>
    </div>
  )
}
