'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

interface KepStatus {
  configured: boolean
  caName?: string
  ownerName?: string
  validTo?: string
  taxId?: string
  updatedAt?: string
}

export default function ClientSettingsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [dpsToken, setDpsToken] = useState('')
  const [kepPassword, setKepPassword] = useState('')
  const [kepStatus, setKepStatus] = useState<KepStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [kepLoading, setKepLoading] = useState(false)
  const [error, setError] = useState('')
  const [kepError, setKepError] = useState('')
  const [success, setSuccess] = useState(false)
  const [kepSuccess, setKepSuccess] = useState<KepStatus | null>(null)

  // Load existing KEP status
  useEffect(() => {
    fetch(`/api/clients/${id}/kep`)
      .then(r => r.json())
      .then(setKepStatus)
      .catch(() => {})
  }, [id])

  async function handleUpdateToken(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)

    const res = await fetch(`/api/clients/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dpsToken }),
    })

    setLoading(false)

    if (!res.ok) {
      const json = await res.json()
      setError(json.error || 'Помилка оновлення токена')
      return
    }

    setSuccess(true)
    setDpsToken('')
    setTimeout(() => setSuccess(false), 3000)
  }

  async function handleUploadKep(e: React.FormEvent) {
    e.preventDefault()
    setKepError('')
    setKepSuccess(null)

    const file = fileRef.current?.files?.[0]
    if (!file) { setKepError('Оберіть файл KEP (.pfx, .jks, .dat)'); return }
    if (!kepPassword) { setKepError('Введіть пароль KEP'); return }

    setKepLoading(true)

    // Read file as base64
    const pfxBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        // result is "data:...;base64,XXXX" — extract only base64 part
        resolve(result.split(',')[1])
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const res = await fetch(`/api/clients/${id}/kep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pfxBase64, password: kepPassword }),
    })

    setKepLoading(false)
    const json = await res.json()

    if (!res.ok) {
      setKepError(json.error + (json.detail ? ': ' + json.detail : ''))
      return
    }

    const info = json.kepInfo as Omit<KepStatus, 'configured'>
    setKepSuccess(info as KepStatus)
    setKepStatus({ ...info, configured: true })
    setKepPassword('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleDelete() {
    if (!confirm('Видалити контрагента? Всі дані будуть втрачені.')) return

    const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/dashboard/clients')
    } else {
      const json = await res.json()
      setError(json.error || 'Помилка видалення')
    }
  }

  return (
    <div className="max-w-lg mx-auto py-10 px-4 space-y-6">
      <div>
        <Link href={`/dashboard/client/${id}`} className="text-sm text-gray-400 hover:text-gray-600">
          ← Назад
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Налаштування контрагента</h1>
      </div>

      {/* KEP upload section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Ключ електронного підпису (KEP)</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Файл .pfx, .jks або .dat + пароль. Зберігаються тільки зашифровані.
          </p>
        </div>

        {kepStatus?.configured && !kepSuccess && (
          <div className="bg-blue-50 rounded-lg px-4 py-3 text-sm space-y-1">
            <div className="font-medium text-blue-800">KEP підключено</div>
            {kepStatus.ownerName && <div className="text-blue-700">Власник: {kepStatus.ownerName}</div>}
            {kepStatus.caName && <div className="text-blue-600">АЦСК: {kepStatus.caName}</div>}
            {kepStatus.taxId && <div className="text-blue-600">Податковий номер: {kepStatus.taxId}</div>}
            {kepStatus.validTo && (
              <div className="text-blue-600">
                Дійсний до: {new Date(kepStatus.validTo).toLocaleDateString('uk-UA')}
              </div>
            )}
          </div>
        )}

        {kepSuccess && (
          <div className="bg-green-50 rounded-lg px-4 py-3 text-sm space-y-1">
            <div className="font-medium text-green-800">KEP успішно збережено!</div>
            {(kepSuccess as unknown as KepStatus & { ownerName?: string }).ownerName && (
              <div className="text-green-700">Власник: {(kepSuccess as unknown as KepStatus & { ownerName?: string }).ownerName}</div>
            )}
            {kepStatus?.caName && <div className="text-green-600">АЦСК: {kepStatus.caName}</div>}
            {kepStatus?.taxId && <div className="text-green-600">Податковий номер: {kepStatus.taxId}</div>}
          </div>
        )}

        <form onSubmit={handleUploadKep} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Файл KEP <span className="text-red-500">*</span>
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".pfx,.p12,.jks,.dat,.cer"
              className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:font-medium hover:file:bg-blue-100 transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Пароль <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              value={kepPassword}
              onChange={(e) => setKepPassword(e.target.value)}
              placeholder="Пароль від KEP"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {kepError && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{kepError}</div>
          )}

          <button
            type="submit"
            disabled={kepLoading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition"
          >
            {kepLoading ? 'Завантаження і перевірка...' : kepStatus?.configured ? 'Оновити KEP' : 'Зберегти KEP'}
          </button>
        </form>
      </div>

      {/* DPS UUID token (optional, legacy) */}
      <form onSubmit={handleUpdateToken} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Токен ДПС (відкрита частина)</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            UUID токен з розділу «Відкриті дані» Електронного кабінету. Необов&apos;язково.
          </p>
        </div>
        <div>
          <textarea
            value={dpsToken}
            onChange={(e) => setDpsToken(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}
        {success && (
          <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg">
            Токен успішно оновлено!
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !dpsToken.trim()}
          className="w-full bg-gray-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-60 transition"
        >
          {loading ? 'Збереження...' : 'Оновити токен'}
        </button>
      </form>

      {/* Danger zone */}
      <div className="bg-white rounded-xl border border-red-200 p-6">
        <h2 className="font-semibold text-red-700 mb-3">Небезпечна зона</h2>
        <button
          onClick={handleDelete}
          className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition"
        >
          Видалити контрагента
        </button>
      </div>

      <div className="text-xs text-gray-400">ID: {id}</div>
    </div>
  )
}
