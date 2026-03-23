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
  const [tokenSuccess, setTokenSuccess] = useState(false)
  // 'idle' | 'uploaded' — tracks post-upload UI state
  const [kepUploadedInfo, setKepUploadedInfo] = useState<KepStatus | null>(null)
  const [showReplaceForm, setShowReplaceForm] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])

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
    setTokenSuccess(false)
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

    setTokenSuccess(true)
    setDpsToken('')
    setTimeout(() => setTokenSuccess(false), 4000)
  }

  async function handleUploadKep(e: React.FormEvent) {
    e.preventDefault()
    setKepError('')

    const files = fileRef.current?.files
    if (!files || files.length === 0) {
      setKepError('Оберіть файл(и) KEP')
      return
    }
    if (!kepPassword) {
      setKepError('Введіть пароль KEP')
      return
    }

    setKepLoading(true)

    // Read all selected files as base64
    const filePayload = await Promise.all(
      Array.from(files).map(
        (file) =>
          new Promise<{ name: string; base64: string }>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () =>
              resolve({
                name: file.name,
                base64: (reader.result as string).split(',')[1],
              })
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
      )
    )

    const res = await fetch(`/api/clients/${id}/kep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: filePayload, password: kepPassword }),
    })

    setKepLoading(false)
    const json = await res.json()

    if (!res.ok) {
      setKepError(json.error + (json.detail ? ': ' + json.detail : ''))
      return
    }

    const info = json.kepInfo as Omit<KepStatus, 'configured'>
    const newStatus: KepStatus = { ...info, configured: true }
    setKepStatus(newStatus)
    setKepUploadedInfo(newStatus)
    setShowReplaceForm(false)
    setKepPassword('')
    setSelectedFiles([])
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

  // Should we show the upload form?
  const showUploadForm = !kepStatus?.configured || showReplaceForm || kepUploadedInfo === null && !kepStatus?.configured

  return (
    <div className="max-w-lg mx-auto py-10 px-4 space-y-6">
      <div>
        <Link href={`/dashboard/client/${id}`} className="text-sm text-gray-400 hover:text-gray-600">
          ← Назад
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Налаштування контрагента</h1>
      </div>

      {/* KEP section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Ключ електронного підпису (KEP)</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Зберігається тільки у зашифрованому вигляді на вашому акаунті.
          </p>
        </div>

        {/* ── Success state after upload ── */}
        {kepUploadedInfo && !showReplaceForm && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 space-y-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="font-semibold text-green-800">Ключ успішно завантажено!</span>
            </div>
            <div className="text-sm text-green-700 space-y-0.5">
              {kepUploadedInfo.ownerName && <div>Власник: <span className="font-medium">{kepUploadedInfo.ownerName}</span></div>}
              {kepUploadedInfo.caName && <div>АЦСК: {kepUploadedInfo.caName}</div>}
              {kepUploadedInfo.taxId && <div>Податковий номер: {kepUploadedInfo.taxId}</div>}
              {kepUploadedInfo.validTo && (
                <div>Дійсний до: {new Date(kepUploadedInfo.validTo).toLocaleDateString('uk-UA')}</div>
              )}
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Link
                href={`/dashboard/client/${id}`}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
              >
                Синхронізувати дані →
              </Link>
              <button
                onClick={() => setShowReplaceForm(true)}
                className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2"
              >
                Замінити ключ
              </button>
            </div>
          </div>
        )}

        {/* ── Existing KEP info (no fresh upload) ── */}
        {kepStatus?.configured && !kepUploadedInfo && !showReplaceForm && (
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
            <button
              onClick={() => setShowReplaceForm(true)}
              className="mt-2 text-xs text-blue-500 hover:text-blue-700 underline underline-offset-2"
            >
              Замінити ключ
            </button>
          </div>
        )}

        {/* ── Upload form ── */}
        {(showUploadForm || showReplaceForm) && (
          <form onSubmit={handleUploadKep} className="space-y-4">
            {showReplaceForm && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Завантажити новий ключ</span>
                <button
                  type="button"
                  onClick={() => { setShowReplaceForm(false); setKepError('') }}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  ✕ Скасувати
                </button>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Файл(и) KEP <span className="text-red-500">*</span>
              </label>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pfx,.p12,.jks,.dat,.cer,.crt,.zs2,.zs3,.zs1,.sk,.zip"
                onChange={(e) => setSelectedFiles(Array.from(e.target.files ?? []))}
                className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:font-medium hover:file:bg-blue-100 transition"
              />
              <p className="text-xs text-gray-400 mt-1">
                Підтримується: .pfx, .p12, .dat, .ZS2, .ZS3, ZIP-архів.
                Якщо ключ та сертифікат у різних файлах — оберіть їх одночасно.
              </p>
              {selectedFiles.length > 1 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {selectedFiles.map((f, i) => (
                    <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {f.name}
                    </span>
                  ))}
                </div>
              )}
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
              {kepLoading
                ? 'Завантаження і перевірка...'
                : kepStatus?.configured
                ? 'Замінити KEP'
                : 'Зберегти KEP'}
            </button>
          </form>
        )}
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
        {tokenSuccess && (
          <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
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
