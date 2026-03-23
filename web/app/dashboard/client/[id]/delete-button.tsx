'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DeleteButton({ clientId, clientName }: { clientId: string; clientName: string }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    setLoading(true)
    const res = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' })
    setLoading(false)
    if (res.ok) {
      router.push('/dashboard/clients')
    } else {
      const json = await res.json()
      setError(json.error || 'Помилка видалення')
      setConfirm(false)
    }
  }

  if (confirm) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Видалити «{clientName}»?</span>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-60 transition"
        >
          {loading ? 'Видалення...' : 'Так, видалити'}
        </button>
        <button
          onClick={() => setConfirm(false)}
          className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
        >
          Скасувати
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="text-sm text-red-400 hover:text-red-600 transition"
      title="Видалити контрагента"
    >
      Видалити
    </button>
  )
}
