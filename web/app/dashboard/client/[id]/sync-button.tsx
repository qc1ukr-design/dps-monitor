'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SyncButton({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [synced, setSynced] = useState(false)

  async function handleSync() {
    setError('')
    setSynced(false)
    setLoading(true)

    const res = await fetch(`/api/clients/${clientId}/sync`, { method: 'POST' })
    const json = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(json.error || 'Помилка оновлення')
      return
    }

    setSynced(true)
    setTimeout(() => setSynced(false), 4000)

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
        ) : synced ? (
          <>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Оновлено!
          </>
        ) : (
          'Оновити дані'
        )}
      </button>
      {synced && (
        <span className="text-xs text-green-600">Дані успішно синхронізовано</span>
      )}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  )
}
