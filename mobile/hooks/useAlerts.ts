import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, getAlerts } from '../lib/api'

interface UseAlertsResult {
  alerts: Alert[]
  unreadCount: number
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useAlerts(): UseAlertsResult {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getAlerts()
      setAlerts(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Невідома помилка')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const unreadCount = useMemo(
    () => alerts.filter((a) => !a.is_read).length,
    [alerts]
  )

  return { alerts, unreadCount, loading, error, refresh: fetchAlerts }
}
