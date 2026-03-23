'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ClientDeleteButton({ clientId, clientName }: { clientId: string; clientName: string }) {
  const router = useRouter()
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setLoading(true)
    const res = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' })
    setLoading(false)
    if (res.ok) {
      router.refresh()
    }
  }

  if (confirm) {
    return (
      <div
        className="flex items-center gap-1.5 shrink-0"
        onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
      >
        <button
          onClick={handleDelete}
          disabled={loading}
          className="text-xs bg-red-600 text-white px-2.5 py-1 rounded-lg hover:bg-red-700 disabled:opacity-60 transition whitespace-nowrap"
        >
          {loading ? '...' : 'Так'}
        </button>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirm(false) }}
          className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-1"
        >
          Ні
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirm(true) }}
      className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition p-1 rounded"
      title={`Видалити ${clientName}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    </button>
  )
}
