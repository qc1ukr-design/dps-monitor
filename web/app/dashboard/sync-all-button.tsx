'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type SyncState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'syncing'; done: number; total: number }
  | { status: 'done'; succeeded: number; total: number }
  | { status: 'error'; message: string }

export default function SyncAllButton() {
  const router = useRouter()
  const [state, setState] = useState<SyncState>({ status: 'idle' })

  async function handleSync() {
    setState({ status: 'loading' })

    let clientIds: string[]
    try {
      const res = await fetch('/api/sync-all')
      if (!res.ok) throw new Error('Не вдалося отримати список клієнтів')
      const json = await res.json() as { clientIds: string[] }
      clientIds = json.clientIds ?? []
    } catch (e) {
      setState({ status: 'error', message: String(e) })
      return
    }

    if (clientIds.length === 0) {
      setState({ status: 'done', succeeded: 0, total: 0 })
      setTimeout(() => {
        setState({ status: 'idle' })
        router.refresh()
      }, 3000)
      return
    }

    setState({ status: 'syncing', done: 0, total: clientIds.length })

    let done = 0
    let succeeded = 0

    await Promise.allSettled(
      clientIds.map(async (id) => {
        try {
          const res = await fetch(`/api/clients/${id}/sync`, { method: 'POST' })
          if (res.ok) succeeded++
        } catch {
          // count as failed
        } finally {
          done++
          setState({ status: 'syncing', done, total: clientIds.length })
        }
      })
    )

    const failures = clientIds.length - succeeded
    setState({ status: 'done', succeeded, total: clientIds.length })

    if (failures > 0) {
      // Keep the done state visible a bit longer so user can see failures
    }

    setTimeout(() => {
      setState({ status: 'idle' })
      router.refresh()
    }, 3000)
  }

  if (state.status === 'loading') {
    return (
      <button
        disabled
        className="flex items-center gap-2 bg-blue-50 text-blue-400 border border-blue-200 px-4 py-2 rounded-lg text-sm font-medium cursor-not-allowed"
      >
        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Завантаження...
      </button>
    )
  }

  if (state.status === 'syncing') {
    return (
      <button
        disabled
        className="flex items-center gap-2 bg-blue-50 text-blue-500 border border-blue-200 px-4 py-2 rounded-lg text-sm font-medium cursor-not-allowed"
      >
        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Оновлення {state.done}/{state.total}...
      </button>
    )
  }

  if (state.status === 'done') {
    const failures = state.total - state.succeeded
    if (failures > 0) {
      return (
        <button
          disabled
          className="flex items-center gap-2 bg-amber-50 text-amber-700 border border-amber-200 px-4 py-2 rounded-lg text-sm font-medium cursor-not-allowed"
        >
          ⚠ Оновлено {state.succeeded}/{state.total} ({failures} помилок)
        </button>
      )
    }
    return (
      <button
        disabled
        className="flex items-center gap-2 bg-green-50 text-green-700 border border-green-200 px-4 py-2 rounded-lg text-sm font-medium cursor-not-allowed"
      >
        ✓ Оновлено {state.succeeded}/{state.total}
      </button>
    )
  }

  if (state.status === 'error') {
    return (
      <button
        onClick={handleSync}
        className="flex items-center gap-2 bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 transition"
      >
        ✕ Помилка — спробувати знову
      </button>
    )
  }

  return (
    <button
      onClick={handleSync}
      className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition shadow-sm"
    >
      🔄 Оновити всіх
    </button>
  )
}
