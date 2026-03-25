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
}

interface TokenStatus {
  configured: boolean
}

export default function ClientSettingsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [kepPassword, setKepPassword] = useState('')
  const [showKepPassword, setShowKepPassword] = useState(false)
  const [kepStatus, setKepStatus] = useState<KepStatus | null>(null)
  const [kepLoading, setKepLoading] = useState(false)
  const [kepError, setKepError] = useState('')
  const [kepUploadedInfo, setKepUploadedInfo] = useState<KepStatus | null>(null)
  const [showReplaceForm, setShowReplaceForm] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])

  const [tokenValue, setTokenValue] = useState('')
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null)
  const [tokenLoading, setTokenLoading] = useState(false)
  const [tokenError, setTokenError] = useState('')
  const [tokenSaved, setTokenSaved] = useState(false)

  useEffect(() => {
    fetch(`/api/clients/${id}/kep`)
      .then(r => r.json())
      .then(setKepStatus)
      .catch(() => {})
    fetch(`/api/clients/${id}/token`)
      .then(r => r.json())
      .then(setTokenStatus)
      .catch(() => {})
  }, [id])

  async function handleSaveToken(e: React.FormEvent) {
    e.preventDefault()
    setTokenError('')
    setTokenSaved(false)
    if (!tokenValue.trim()) { setTokenError('Введіть токен'); return }
    setTokenLoading(true)
    const res = await fetch(`/api/clients/${id}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: tokenValue }),
    })
    setTokenLoading(false)
    const json = await res.json()
    if (!res.ok) { setTokenError(json.error); return }
    setTokenStatus({ configured: true })
    setTokenSaved(true)
    setTokenValue('')
  }

  async function handleDeleteToken() {
    if (!confirm('Видалити UUID-токен?')) return
    await fetch(`/api/clients/${id}/token`, { method: 'DELETE' })
    setTokenStatus({ configured: false })
    setTokenSaved(false)
  }

  async function handleUploadKep(e: React.FormEvent) {
    e.preventDefault()
    setKepError('')

    const files = fileRef.current?.files
    if (!files || files.length === 0) { setKepError('Оберіть файл(и) KEP'); return }
    if (!kepPassword) { setKepError('Введіть пароль KEP'); return }

    setKepLoading(true)

    const filePayload = await Promise.all(
      Array.from(files).map(file =>
        new Promise<{ name: string; base64: string }>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve({ name: file.name, base64: (reader.result as string).split(',')[1] })
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
      const detail = json.detail ?? ''
      if (detail.includes('NO_CERT')) {
        setKepError(
          'Сертифікат не знайдено у файлі та на серверах ЦСК.\n\n' +
          'Спробуйте завантажити .pfx разом із файлом сертифіката (.cer) одночасно.'
        )
      } else {
        setKepError(json.error + (detail ? '\n' + detail : ''))
      }
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
    }
  }

  const showUploadForm = !kepStatus?.configured || showReplaceForm

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
          <h2 className="font-semibold text-gray-900">Ключ електронного підпису (КЕП)</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Зберігається тільки у зашифрованому вигляді на вашому акаунті.
          </p>
        </div>

        {/* Success after upload */}
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
                <div>Дійсний до: {new Date(kepUploadedInfo.validTo).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kiev' })}</div>
              )}
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Link
                href={`/dashboard/client/${id}`}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
              >
                До кабінету контрагента →
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

        {/* Existing KEP (no fresh upload) */}
        {kepStatus?.configured && !kepUploadedInfo && !showReplaceForm && (
          <div className="bg-blue-50 rounded-lg px-4 py-3 text-sm space-y-1">
            <div className="font-medium text-blue-800">КЕП підключено</div>
            {kepStatus.ownerName && <div className="text-blue-700">Власник: {kepStatus.ownerName}</div>}
            {kepStatus.caName && <div className="text-blue-600">АЦСК: {kepStatus.caName}</div>}
            {kepStatus.taxId && <div className="text-blue-600">Податковий номер: {kepStatus.taxId}</div>}
            {kepStatus.validTo && (
              <div className="text-blue-600">
                Дійсний до: {new Date(kepStatus.validTo).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kiev' })}
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

        {/* Upload form */}
        {showUploadForm && (
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
                Файл(и) КЕП <span className="text-red-500">*</span>
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
              <div className="relative">
                <input
                  type={showKepPassword ? 'text' : 'password'}
                  value={kepPassword}
                  onChange={(e) => setKepPassword(e.target.value)}
                  placeholder="Пароль від КЕП"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowKepPassword(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                  tabIndex={-1}
                >
                  {showKepPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {kepError && (
              <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg whitespace-pre-line">{kepError}</div>
            )}

            <button
              type="submit"
              disabled={kepLoading}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition"
            >
              {kepLoading ? 'Завантаження і перевірка...' : kepStatus?.configured ? 'Замінити КЕП' : 'Зберегти КЕП'}
            </button>
          </form>
        )}
      </div>

      {/* UUID token section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">UUID-токен ДПС</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Резервний метод доступу до документів та звітності (якщо КЕП не спрацьовує). Зберігається зашифровано.
          </p>
        </div>

        {tokenStatus?.configured && !tokenSaved && (
          <div className="bg-blue-50 rounded-lg px-4 py-3 text-sm flex items-center justify-between">
            <span className="text-blue-800 font-medium">Токен налаштовано</span>
            <button
              onClick={handleDeleteToken}
              className="text-xs text-red-400 hover:text-red-600 underline underline-offset-2"
            >
              Видалити
            </button>
          </div>
        )}

        {tokenSaved && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
            Токен збережено успішно!
          </div>
        )}

        <form onSubmit={handleSaveToken} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {tokenStatus?.configured ? 'Замінити токен' : 'Токен'} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={tokenValue}
              onChange={e => setTokenValue(e.target.value)}
              placeholder="Вставте UUID-токен з кабінету ДПС"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">
              Кабінет ДПС → Профіль → Відкриті дані → скопіюйте токен доступу.
            </p>
          </div>
          {tokenError && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{tokenError}</div>
          )}
          <button
            type="submit"
            disabled={tokenLoading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition"
          >
            {tokenLoading ? 'Збереження...' : tokenStatus?.configured ? 'Замінити токен' : 'Зберегти токен'}
          </button>
        </form>
      </div>

      {/* Delete — subtle link, not scary red block */}
      <div className="text-center">
        <button
          onClick={handleDelete}
          className="text-xs text-gray-400 hover:text-red-500 transition underline underline-offset-2"
        >
          Видалити контрагента
        </button>
      </div>
    </div>
  )
}
