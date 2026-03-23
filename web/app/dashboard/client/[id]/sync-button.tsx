'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SyncButton({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSync() {
    setError('')
    setLoading(true)

    const res = await fetch(`/api/clients/${clientId}/sync`, { method: 'POST' })
    const json = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(json.error || 'Помилка оновлення')
      return
    }

    // Refresh server component data
    router.refresh()
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleSync}
        disabled={loading}
        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Оновлення...
          </>
        ) : (
          'Оновити дані'
        )}
      </button>
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
