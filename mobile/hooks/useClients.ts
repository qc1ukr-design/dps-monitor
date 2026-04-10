import { useCallback, useEffect, useState } from 'react'
import { Client, getClients, syncAll } from '../lib/api'

interface UseClientsResult {
  clients: Client[]
  lastSyncAt: string | null
  loading: boolean
  syncing: boolean
  error: string | null
  refresh: () => Promise<void>
  syncAllClients: () => Promise<void>
}

export function useClients(): UseClientsResult {
  const [clients, setClients] = useState<Client[]>([])
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchClients = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getClients()
      // Handle both old array format and new { clients, lastSyncAt } format
      if (Array.isArray(data)) {
        setClients(data as unknown as Client[])
        setLastSyncAt(null)
      } else {
        setClients(data.clients ?? [])
        setLastSyncAt(data.lastSyncAt)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Невідома помилка')
    } finally {
      setLoading(false)
    }
  }, [])

  const syncAllClients = useCallback(async () => {
    if (clients.length === 0) return
    setSyncing(true)
    setError(null)
    try {
      await syncAll(clients.map(c => c.id))
      await fetchClients()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка синхронізації')
    } finally {
      setSyncing(false)
    }
  }, [clients, fetchClients])

  useEffect(() => {
    fetchClients()
  }, [fetchClients])

  return { clients, lastSyncAt, loading, syncing, error, refresh: fetchClients, syncAllClients }
}
