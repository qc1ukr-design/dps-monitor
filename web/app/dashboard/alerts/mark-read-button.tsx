'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function MarkReadButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      await fetch('/api/alerts/mark-read', { method: 'POST' })
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
      {loading ? 'Оновлення...' : 'Позначити всі як прочитані'}
    </button>
  )
}
