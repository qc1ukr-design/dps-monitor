import { supabase } from './supabase'
import { API_BASE_URL } from './constants'

export interface Client {
  id: string
  name: string
  edrpou: string
  debt?: number
  overpayment?: number
  status?: string
}

export interface ClientDetail {
  id: string
  name: string
  edrpou: string
  debt?: number
  overpayment?: number
  status?: string
  kepValidTo?: string
  lastSyncAt?: string
}

export interface Document {
  id: string
  cdoc: string
  name: string
  date: string
  csti?: string
  text?: string
}

export interface Alert {
  id: string
  client_id: string
  client_name?: string
  type: string
  message: string
  is_read: boolean
  created_at: string
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15_000)

  try {
    const { data: { session } } = await supabase.auth.getSession()

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> ?? {}),
    }
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    })

    if (response.status === 401) {
      await supabase.auth.signOut()
      throw new Error('Сесія завершена. Увійдіть знову.')
    }

    if (!response.ok) {
      const text = await response.text()
      if (__DEV__) {
        console.warn(`API error ${response.status}:`, text)
      }
      throw new Error(`Помилка сервера (${response.status})`)
    }

    return response.json() as Promise<T>
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error("Час очікування відповіді вичерпано. Перевірте з'єднання.")
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export function getClients(): Promise<Client[]> {
  return apiFetch<Client[]>('/api/clients')
}

export function getClient(id: string): Promise<ClientDetail> {
  return apiFetch<ClientDetail>(`/api/clients/${id}`)
}

export function getDocuments(id: string): Promise<Document[]> {
  return apiFetch<Document[]>(`/api/clients/${id}/documents`)
}

export function syncClient(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/clients/${id}/sync`, {
    method: 'POST',
  })
}

export function getAlerts(): Promise<Alert[]> {
  return apiFetch<Alert[]>('/api/alerts')
}

export function markAlertsRead(clientId?: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/api/alerts/mark-read', {
    method: 'POST',
    body: clientId ? JSON.stringify({ client_id: clientId }) : undefined,
  })
}
