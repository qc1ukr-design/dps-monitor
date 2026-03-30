'use client'

import { useState } from 'react'

type State = 'idle' | 'loading' | 'done' | 'error'

export default function ExcelExportButton() {
  const [state, setState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleClick() {
    if (state === 'loading') return
    setState('loading')
    setErrorMsg('')

    try {
      const res = await fetch('/api/export/excel', { cache: 'no-store' })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `HTTP ${res.status}`)
      }

      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const date = new Date().toISOString().slice(0, 10)
      a.href     = url
      a.download = `dps-monitor-${date}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setState('done')
      setTimeout(() => setState('idle'), 4000)
    } catch (e) {
      setErrorMsg(String(e).slice(0, 120))
      setState('error')
      setTimeout(() => setState('idle'), 6000)
    }
  }

  const isLoading = state === 'loading'
  const isDone    = state === 'done'
  const isError   = state === 'error'

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleClick}
        disabled={isLoading}
        className={`
          w-full text-left rounded-xl border p-5 transition-all
          ${isLoading
            ? 'border-blue-300 bg-blue-50 cursor-wait'
            : isDone
            ? 'border-green-300 bg-green-50 cursor-pointer hover:shadow-md'
            : isError
            ? 'border-red-300 bg-red-50 cursor-pointer'
            : 'border-blue-200 bg-white hover:shadow-md hover:border-blue-400 cursor-pointer active:scale-[0.99]'
          }
        `}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-2xl leading-none">
                {isDone ? '✅' : isError ? '❌' : '📊'}
              </span>
              <h3 className="font-semibold text-gray-900">Excel-звіт</h3>
            </div>

            {isLoading ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-blue-700">Запит отримано, звіт формується…</p>
                <p className="text-xs text-blue-500">
                  Завантажуємо дані з ДПС для кожного клієнта — зазвичай 15–30 секунд.
                  <br />Не закривайте сторінку і не натискайте повторно.
                </p>
                <div className="mt-2 h-1 bg-blue-100 rounded-full overflow-hidden">
                  <div className="h-full w-full bg-blue-400 rounded-full origin-left animate-pulse" />
                </div>
              </div>
            ) : isDone ? (
              <div>
                <p className="text-sm font-medium text-green-700">Звіт готовий — файл завантажено</p>
                <p className="text-xs text-green-500 mt-0.5">Зведений звіт, бюджет та звітність</p>
              </div>
            ) : isError ? (
              <div>
                <p className="text-sm font-medium text-red-700">Помилка формування звіту</p>
                <p className="text-xs text-red-500 mt-0.5 break-all">{errorMsg}</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-500">Зведений звіт по всіх клієнтах</p>
                <p className="text-xs text-gray-400 mt-0.5">3 аркуші: підсумок, бюджет, звітність</p>
              </div>
            )}
          </div>

          {/* Right indicator */}
          <div className="flex-shrink-0 mt-0.5">
            {isLoading ? (
              <svg className="w-5 h-5 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <span className={`text-lg ${isDone ? 'text-green-400' : isError ? 'text-red-400' : 'text-gray-300 group-hover:text-blue-400'}`}>
                ↓
              </span>
            )}
          </div>
        </div>

        {/* Active badge */}
        {!isLoading && !isDone && !isError && (
          <div className="mt-3">
            <span className="inline-block text-xs px-2 py-0.5 rounded font-medium bg-green-100 text-green-700">
              Активний
            </span>
            <span className="ml-2 inline-block text-xs px-2 py-0.5 rounded font-medium bg-blue-50 text-blue-600 border border-blue-100">
              ⬇ Завантажити
            </span>
          </div>
        )}
      </button>
    </div>
  )
}
