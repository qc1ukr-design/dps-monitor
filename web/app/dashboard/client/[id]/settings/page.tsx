'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

export default function ClientSettingsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [dpsToken, setDpsToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleUpdateToken(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)

    const res = await fetch(`/api/clients/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dpsToken }),
    })

    setLoading(false)

    if (!res.ok) {
      const json = await res.json()
      setError(json.error || 'Помилка оновлення токена')
      return
    }

    setSuccess(true)
    setDpsToken('')
    setTimeout(() => router.push(`/dashboard/client/${id}`), 1500)
  }

  async function handleDelete() {
    if (!confirm('Видалити контрагента? Всі дані будуть втрачені.')) return

    const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/dashboard/clients')
    } else {
      const json = await res.json()
      setError(json.error || 'Помилка видалення')
    }
  }

  return (
    <div className="max-w-lg mx-auto py-10 px-4 space-y-6">
      <div>
        <Link href={`/dashboard/client/${id}`} className="text-sm text-gray-400 hover:text-gray-600">
          ← Назад
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Налаштування контрагента</h1>
      </div>

      <form onSubmit={handleUpdateToken} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Оновити токен ДПС API</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Новий токен <span className="text-red-500">*</span>
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
          <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}
        {success && (
          <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg">
            Токен успішно оновлено! Перенаправлення...
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition"
        >
          {loading ? 'Збереження...' : 'Оновити токен'}
        </button>
      </form>

      <div className="bg-white rounded-xl border border-red-200 p-6">
        <h2 className="font-semibold text-red-700 mb-3">Небезпечна зона</h2>
        <button
          onClick={handleDelete}
          className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition"
        >
          Видалити контрагента
        </button>
      </div>

      <div className="text-xs text-gray-400">ID: {id}</div>
    </div>
  )
}
