import { useCallback, useEffect, useState } from 'react'
import { Document, getDocuments } from '../lib/api'

interface UseDocumentsResult {
  documents: Document[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useDocuments(clientId: string): UseDocumentsResult {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDocuments = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getDocuments(clientId)
      setDocuments(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Невідома помилка')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  return { documents, loading, error, refresh: fetchDocuments }
}
