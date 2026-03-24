'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Props {
  clientId?: string
  label?: string
}

export default function MarkReadButton({ clientId, label }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const url = clientId
        ? `/api/alerts/mark-read?client_id=${clientId}`
        : '/api/alerts/mark-read'
      await fetch(url, { method: 'POST' })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
    >
      {loading ? 'Оновлення...' : (label ?? 'Позначити всі як прочитані')}
    </button>
  )
}
