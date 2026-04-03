'use client'

import { useState, useRef, useCallback, DragEvent, ChangeEvent } from 'react'

export interface KepInfo {
  caName?: string | null
  ownerName?: string | null
  orgName?: string | null
  taxId?: string | null
  validTo?: string | null
}

interface KepUploadFormProps {
  clientId: string
  onSuccess: (kepInfo: KepInfo) => void
  onCancel?: () => void
  replacing?: boolean
}

const ACCEPTED_EXTS = ['.jks', '.p12', '.pfx', '.dat', '.cer', '.crt', '.zs2', '.zs3', '.zs1', '.sk', '.zip']
const ACCEPTED_ATTR = ACCEPTED_EXTS.join(',')

function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return ACCEPTED_EXTS.some(ext => name.endsWith(ext))
}

export default function KepUploadForm({ clientId, onSuccess, onCancel, replacing = false }: KepUploadFormProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((incoming: File[]) => {
    const valid = incoming.filter(isAcceptedFile)
    if (valid.length === 0) {
      if (incoming.length > 0) setError('Непідтримуваний тип файлу. Оберіть .pfx, .p12, .dat, .jks або інший дозволений формат.')
      return
    }
    setError('')
    setSelectedFiles(prev => {
      const existingNames = new Set(prev.map(f => f.name))
      const fresh = valid.filter(f => !existingNames.has(f.name))
      return [...prev, ...fresh]
    })
    setError('')
  }, [])

  function handleDropZoneClick() {
    fileInputRef.current?.click()
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      addFiles(Array.from(e.target.files))
      // Reset so re-selecting same file works
      e.target.value = ''
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files) {
      addFiles(Array.from(e.dataTransfer.files))
    }
  }

  function removeFile(index: number) {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (selectedFiles.length === 0) {
      setError('Оберіть файл(и) КЕП')
      return
    }
    if (!password) {
      setError('Введіть пароль КЕП')
      return
    }

    setLoading(true)

    let filePayload: Array<{ name: string; base64: string }>
    try {
      filePayload = await Promise.all(
        selectedFiles.map(
          file =>
            new Promise<{ name: string; base64: string }>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => {
                const result = reader.result as string
                const base64 = result.split(',')[1]
                if (!base64) { reject(new Error(`Не вдалося прочитати файл: ${file.name}`)); return }
                resolve({ name: file.name, base64 })
              }
              reader.onerror = reject
              reader.readAsDataURL(file)
            }),
        ),
      )
    } catch {
      setLoading(false)
      setError('Помилка читання файлів. Спробуйте ще раз.')
      return
    }

    let res: Response
    try {
      res = await fetch(`/api/clients/${clientId}/kep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filePayload, password }),
      })
    } catch {
      setLoading(false)
      setError('Мережева помилка. Перевірте з\'єднання та спробуйте ще раз.')
      return
    }

    setLoading(false)

    let json: { ok?: boolean; kepInfo?: KepInfo; error?: string; detail?: string }
    try {
      json = await res.json()
    } catch {
      setError('Неочікувана відповідь сервера. Спробуйте ще раз.')
      return
    }

    if (!res.ok) {
      const detail = json.detail ?? ''
      if (detail.includes('NO_CERT')) {
        setError(
          'Сертифікат не знайдено у файлі та на серверах ЦСК.\n\n' +
          'Спробуйте завантажити .pfx разом із файлом сертифіката (.cer) одночасно.',
        )
      } else {
        setError((json.error ?? 'Помилка завантаження') + (detail ? '\n' + detail : ''))
      }
      return
    }

    // Clear password from state immediately after success — never persist outside component
    setPassword('')
    setSelectedFiles([])

    if (json.kepInfo) {
      onSuccess(json.kepInfo)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      {/* Drag & drop zone */}
      <div>
        <div
          role="button"
          tabIndex={0}
          onClick={handleDropZoneClick}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleDropZoneClick() }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={[
            'w-full min-h-24 border-2 border-dashed rounded-xl px-4 py-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors select-none',
            isDragOver
              ? 'border-blue-400 bg-blue-50'
              : 'border-gray-300 bg-gray-50 hover:border-blue-300 hover:bg-blue-50/50',
          ].join(' ')}
        >
          <svg
            className={['w-8 h-8 shrink-0', isDragOver ? 'text-blue-500' : 'text-gray-400'].join(' ')}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <p className={['text-sm text-center', isDragOver ? 'text-blue-600' : 'text-gray-500'].join(' ')}>
            Перетягніть файл(и) сюди або натисніть для вибору
          </p>
          <p className="text-xs text-gray-400 text-center">
            {ACCEPTED_EXTS.join(', ')}
          </p>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_ATTR}
          onChange={handleFileInputChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />

        {/* Selected files chips */}
        {selectedFiles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5" role="list" aria-label="Обрані файли">
            {selectedFiles.map((file, index) => (
              <span
                key={index}
                role="listitem"
                className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full"
              >
                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {file.name}
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  className="ml-0.5 text-blue-400 hover:text-blue-700 transition-colors"
                  aria-label={`Видалити файл ${file.name}`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Hint for legal entities (ЮО) */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-xs text-amber-800">
        <span className="font-semibold">Для юридичних осіб:</span>{' '}
        завантажте одночасно <em>ключ директора</em> та <em>ключ-печатку</em> підприємства.
        Якщо сертифікат печатки зберігається в окремому файлі (.cer) — додайте його також.
      </div>

      {/* Password field */}
      <div>
        <label htmlFor="kep-password" className="block text-sm font-medium text-gray-700 mb-1">
          Пароль <span className="text-red-500" aria-hidden="true">*</span>
        </label>
        <div className="relative">
          <input
            id="kep-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Пароль від КЕП"
            autoComplete="off"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            disabled={loading}
            aria-required="true"
          />
          <button
            type="button"
            onClick={() => setShowPassword(v => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            tabIndex={-1}
            aria-label={showPassword ? 'Сховати пароль' : 'Показати пароль'}
          >
            {showPassword ? (
              // Eye-off icon
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            ) : (
              // Eye icon
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Error block */}
      {error && (
        <div
          role="alert"
          className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg whitespace-pre-line border border-red-200"
        >
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {loading ? 'Завантаження і перевірка...' : replacing ? 'Замінити КЕП' : 'Зберегти КЕП'}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="sm:w-auto px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 disabled:opacity-60 transition-colors"
          >
            Скасувати
          </button>
        )}
      </div>
    </form>
  )
}
