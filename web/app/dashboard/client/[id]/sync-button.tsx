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

    try {
      const res = await fetch(`/api/clients/${clientId}/sync`, { method: 'POST' })

      let json: Record<string, unknown> = {}
      try {
        json = await res.json()
      } catch {
        // Non-JSON response (e.g. Vercel 504 timeout)
      }

      setLoading(false)

      if (!res.ok) {
        const msg = (json.error as string) || `Помилка (HTTP ${res.status})`
        const detail = (json.detail as string) || ''
        setError(detail ? `${msg}\n${detail}` : msg)
        return
      }

      // Check if DPS actually returned data (sync may return 200 OK but DPS auth failed)
      type DpsResult = { ok: boolean; status?: number; body?: string; dbError?: string | null }
      const results = json.results as { profile?: DpsResult; budget?: DpsResult } | undefined
      const profileOk = results?.profile?.ok ?? true
      const budgetOk  = results?.budget?.ok  ?? true

      if (!profileOk && !budgetOk) {
        const status = results?.profile?.status ?? results?.budget?.status ?? '?'
        const body   = results?.profile?.body   ?? results?.budget?.body   ?? ''
        setError(`ДПС повернула помилку (HTTP ${status}).\n${body}`)
        return
      }

      setSynced(true)
      setTimeout(() => setSynced(false), 4000)
      router.refresh()
    } catch (e) {
      setLoading(false)
      setError(`Мережева помилка: ${String(e)}`)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 max-w-xs">
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
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 whitespace-pre-wrap text-right max-w-[280px]">
          {error}
        </div>
      )}
    </div>
  )
}
