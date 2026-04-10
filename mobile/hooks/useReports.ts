import { useState, useEffect, useCallback } from 'react'
import { getReports, TaxReport, ReportsResponse } from '../lib/api'

interface UseReportsResult {
  reports: TaxReport[]
  loading: boolean
  error: string | null
  hasToken: boolean
  noAccess: boolean
  refresh: () => Promise<void>
}

export function useReports(clientId: string): UseReportsResult {
  const [data, setData] = useState<ReportsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const result = await getReports(clientId)
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  return {
    reports: data?.reports ?? [],
    loading,
    error,
    hasToken: data?.hasToken ?? true,
    noAccess: data?.noAccess ?? false,
    refresh: fetchData,
  }
}
