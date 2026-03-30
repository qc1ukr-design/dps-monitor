'use client'

import { useEffect, useState } from 'react'

export default function SettingsPage() {
  const [chatId, setChatId] = useState('')
  const [notify, setNotify] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/notifications')
      .then(r => r.json())
      .then(d => {
        setChatId(d.telegram_chat_id ?? '')
        setNotify(d.notify_telegram ?? false)
      })
      .finally(() => setLoading(false))
  }, [])

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const r = await fetch('/api/settings/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_chat_id: chatId, notify_telegram: notify }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Помилка')
      setMessage({ type: 'ok', text: 'Налаштування збережено' })
    } catch (e) {
      setMessage({ type: 'err', text: String(e) })
    } finally {
      setSaving(false)
    }
  }

  async function sendTest() {
    setTesting(true)
    setMessage(null)
    try {
      const r = await fetch('/api/settings/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_chat_id: chatId, test: true }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Помилка')
      setMessage({ type: 'ok', text: 'Тестове повідомлення надіслано! Перевірте Telegram.' })
    } catch (e) {
      setMessage({ type: 'err', text: String(e) })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4">
        <p className="text-gray-500 text-sm">Завантаження…</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Налаштування</h1>
        <p className="text-sm text-gray-500 mt-1">Сповіщення та інтеграції</p>
      </div>

      {/* Telegram */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="flex items-center gap-3">
          <span className="text-2xl">✈️</span>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Telegram-сповіщення</h2>
            <p className="text-sm text-gray-500">Отримуйте алерти про зміни боргу та статусу прямо в Telegram</p>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-blue-800 space-y-1">
          <p className="font-medium">Як підключити:</p>
          <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
            <li>Відкрийте <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="underline font-medium">@userinfobot</a> у Telegram</li>
            <li>Натисніть <strong>/start</strong> — бот покаже ваш Chat ID</li>
            <li>Вставте Chat ID нижче та натисніть «Перевірити»</li>
          </ol>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Telegram Chat ID
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatId}
                onChange={e => setChatId(e.target.value)}
                placeholder="Наприклад: 123456789"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={sendTest}
                disabled={testing || !chatId.trim()}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {testing ? 'Надсилаємо…' : 'Перевірити'}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={notify}
              onChange={e => setNotify(e.target.checked)}
              className="w-4 h-4 rounded accent-blue-600"
            />
            <span className="text-sm text-gray-700">Надсилати Telegram-сповіщення при змінах</span>
          </label>
        </div>

        {message && (
          <div className={`rounded-lg px-4 py-2.5 text-sm ${
            message.type === 'ok'
              ? 'bg-green-50 text-green-800 border border-green-100'
              : 'bg-red-50 text-red-800 border border-red-100'
          }`}>
            {message.text}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition"
          >
            {saving ? 'Збереження…' : 'Зберегти'}
          </button>
        </div>
      </div>
    </div>
  )
}
