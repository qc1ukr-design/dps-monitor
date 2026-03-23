'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface CreatedClient {
  id: string
  name: string
  taxId: string
  caName: string
  validTo: string
}

export default function NewClientPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<CreatedClient | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const files = fileRef.current?.files
    if (!files || files.length === 0) {
      setError('Оберіть файл(и) KEP')
      return
    }
    if (!password) {
      setError('Введіть пароль KEP')
      return
    }

    setLoading(true)

    // Read all files as base64
    const filePayload = await Promise.all(
      Array.from(files).map(
        (file) =>
          new Promise<{ name: string; base64: string }>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () =>
              resolve({ name: file.name, base64: (reader.result as string).split(',')[1] })
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
      )
    )

    const res = await fetch('/api/clients/from-kep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: filePayload, password }),
    })

    setLoading(false)
    const json = await res.json()

    if (!res.ok) {
      setError(json.error + (json.detail ? ': ' + json.detail : ''))
      return
    }

    setCreated(json as CreatedClient)
  }

  // After creation — success screen
  if (created) {
    return (
      <div className="max-w-lg mx-auto py-10 px-4">
        <div className="mb-8">
          <Link href="/dashboard/clients" className="text-sm text-gray-400 hover:text-gray-600">
            ← Контрагенти
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">Новий контрагент</h1>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-xl px-6 py-5 space-y-3">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-semibold text-green-800">Клієнта успішно додано!</span>
          </div>
          <div className="text-sm text-green-700 space-y-0.5 pl-7">
            <div>Ім&apos;я: <span className="font-medium">{created.name}</span></div>
            {created.taxId && <div>РНОКПП/ЄДРПОУ: <span className="font-medium">{created.taxId}</span></div>}
            {created.caName && <div>АЦСК: {created.caName}</div>}
            {created.validTo && (
              <div>Ключ дійсний до: {new Date(created.validTo).toLocaleDateString('uk-UA')}</div>
            )}
          </div>
          <div className="pl-7 pt-1">
            <button
              onClick={() => router.push(`/dashboard/client/${created.id}`)}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition"
            >
              Перейти до контрагента →
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto py-10 px-4">
      <div className="mb-8">
        <Link href="/dashboard/clients" className="text-sm text-gray-400 hover:text-gray-600">
          ← Контрагенти
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Новий контрагент</h1>
        <p className="text-gray-500 text-sm mt-1">
          Завантажте KEP — назва та ЄДРПОУ зчитаються автоматично
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* File picker */}
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
            .pfx, .p12, .dat, .ZS2, .ZS3, ZIP-архів або .dat + .cer разом
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

        {/* Password with show/hide */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Пароль KEP <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Пароль від ключа"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
              tabIndex={-1}
            >
              {showPassword ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Зчитування ключа...
            </span>
          ) : (
            'Зчитати ключ і додати контрагента →'
          )}
        </button>

        <Link
          href="/dashboard/clients"
          className="block text-center text-sm text-gray-400 hover:text-gray-600"
        >
          Скасувати
        </Link>
      </form>
    </div>
  )
}
