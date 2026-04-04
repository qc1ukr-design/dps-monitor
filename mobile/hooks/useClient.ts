import { useCallback, useEffect, useState } from 'react'
import { ClientDetail, getClient } from '../lib/api'

interface UseClientResult {
  client: ClientDetail | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useClient(clientId: string): UseClientResult {
  const [client, setClient] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchClient = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getClient(clientId)
      setClient(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Невідома помилка')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    fetchClient()
  }, [fetchClient])

  return { client, loading, error, refresh: fetchClient }
}
