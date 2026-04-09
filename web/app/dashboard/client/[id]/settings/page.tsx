'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import KepUploadForm, { type KepInfo } from './KepUploadForm'

interface KepStatus {
  configured: boolean
  caName?: string
  ownerName?: string
  orgName?: string
  validTo?: string
  taxId?: string
}

interface TokenStatus {
  configured: boolean
}

export default function ClientSettingsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [kepStatus, setKepStatus] = useState<KepStatus | null>(null)
  const [kepUploadedInfo, setKepUploadedInfo] = useState<KepInfo | null>(null)
  const [showReplaceForm, setShowReplaceForm] = useState(false)

  const [tokenValue, setTokenValue] = useState('')
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null)
  const [tokenLoading, setTokenLoading] = useState(false)
  const [tokenError, setTokenError] = useState('')
  const [tokenSaved, setTokenSaved] = useState(false)

  const [isArchived, setIsArchived] = useState(false)
  const [archiveLoading, setArchiveLoading] = useState(false)

  const [taxSystem, setTaxSystem] = useState<'simplified' | 'general'>('simplified')
  const [taxSystemSaved, setTaxSystemSaved] = useState(false)
  const [isYuo, setIsYuo] = useState(false)

  useEffect(() => {
    fetch(`/api/clients/${id}/kep`)
      .then(r => r.json())
      .then(setKepStatus)
      .catch(() => {})
    fetch(`/api/clients/${id}/token`)
      .then(r => r.json())
      .then(setTokenStatus)
      .catch(() => {})
    fetch(`/api/clients/${id}`)
      .then(r => r.json())
      .then(d => {
        if (typeof d.is_archived === 'boolean') setIsArchived(d.is_archived)
        if (d.tax_system === 'simplified' || d.tax_system === 'general') setTaxSystem(d.tax_system)
        if (typeof d.edrpou === 'string') setIsYuo(/^\d{8}$/.test(d.edrpou))
      })
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
    const res = await fetch(`/api/clients/${id}/token`, { method: 'DELETE' })
    if (res.ok) {
      setTokenStatus({ configured: false })
      setTokenSaved(false)
    }
  }

  function handleKepSuccess(kepInfo: KepInfo) {
    const newStatus: KepStatus = {
      configured: true,
      caName: kepInfo.caName ?? undefined,
      ownerName: kepInfo.ownerName ?? undefined,
      orgName: kepInfo.orgName ?? undefined,
      taxId: kepInfo.taxId ?? undefined,
      validTo: kepInfo.validTo ?? undefined,
    }
    setKepStatus(newStatus)
    setKepUploadedInfo(kepInfo)
    setShowReplaceForm(false)
  }

  async function handleTaxSystemChange(value: 'simplified' | 'general') {
    setTaxSystem(value)
    setTaxSystemSaved(false)
    const res = await fetch(`/api/clients/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tax_system: value }),
    })
    if (res.ok) {
      setTaxSystemSaved(true)
      setTimeout(() => setTaxSystemSaved(false), 3000)
    }
  }

  async function handleArchiveToggle() {
    const next = !isArchived
    const msg = next
      ? 'Архівувати контрагента? Він буде прихований з основного списку (можна розархівувати).'
      : 'Розархівувати контрагента?'
    if (!confirm(msg)) return
    setArchiveLoading(true)
    const res = await fetch(`/api/clients/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_archived: next }),
    })
    setArchiveLoading(false)
    if (res.ok) {
      if (next) router.push('/dashboard')
      else setIsArchived(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Видалити контрагента? Всі дані будуть втрачені.')) return
    const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/dashboard/clients')
    }
  }

  const showUploadForm = kepStatus !== null && (!kepStatus.configured || showReplaceForm)

  return (
    <div className="max-w-lg mx-auto py-10 px-4 space-y-6">
      <div>
        <Link
          href={`/dashboard/client/${id}`}
          className="inline-flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 text-sm font-medium px-3 py-1.5 rounded-lg transition-all"
        >
          ‹ Назад
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
              {kepUploadedInfo.ownerName && (
                <div>
                  Підписант: <span className="font-medium">{kepUploadedInfo.ownerName}</span>
                  {kepUploadedInfo.orgName && <span className="text-green-600"> · {kepUploadedInfo.orgName}</span>}
                </div>
              )}
              {kepUploadedInfo.caName && <div>АЦСК: {kepUploadedInfo.caName}</div>}
              {kepUploadedInfo.taxId && <div>Ідентифікатор: {kepUploadedInfo.taxId}</div>}
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
            {kepStatus.ownerName && (
              <div className="text-blue-700">
                Підписант: {kepStatus.ownerName}
                {kepStatus.orgName && <span className="text-blue-600"> · {kepStatus.orgName}</span>}
              </div>
            )}
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
          <KepUploadForm
            clientId={id}
            replacing={showReplaceForm}
            onSuccess={handleKepSuccess}
            onCancel={showReplaceForm ? () => setShowReplaceForm(false) : undefined}
          />
        )}
      </div>

      {/* UUID token section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Токен сесії ДПС</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Потрібен для перегляду звітності та вхідної документації. Дійсний кілька годин після входу в кабінет.
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

        {/* How to get the token */}
        <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-600 space-y-1.5">
          <p className="font-medium text-gray-700">Як отримати токен:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Відкрийте <a href="https://cabinet.tax.gov.ua" target="_blank" rel="noopener noreferrer" className="underline text-blue-600 hover:text-blue-800">cabinet.tax.gov.ua</a> та увійдіть через КЕП</li>
            <li>Перейдіть до розділу <strong>Налаштування</strong></li>
            <li>Відкрийте підрозділ <strong>Відкриті дані</strong></li>
            <li>Натисніть <strong>Згенерувати токен</strong> та скопіюйте його</li>
            <li>Вставте токен у поле нижче</li>
          </ol>
        </div>

        <form onSubmit={handleSaveToken} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {tokenStatus?.configured ? 'Замінити токен' : 'Токен'} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={tokenValue}
              onChange={e => setTokenValue(e.target.value)}
              placeholder="Вставте токен з розділу Відкриті дані"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
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

      {/* Tax system section — only for ФО/ФОП, not ЮО */}
      {!isYuo && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div>
            <h2 className="font-semibold text-gray-900">Система оподаткування</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Впливає на фільтрацію повідомлень BOTB0501 від ДПС.
            </p>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="tax_system"
                value="simplified"
                checked={taxSystem === 'simplified'}
                onChange={() => handleTaxSystemChange('simplified')}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-sm text-gray-700">ФОП / єдиний податок</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="tax_system"
                value="general"
                checked={taxSystem === 'general'}
                onChange={() => handleTaxSystemChange('general')}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-sm text-gray-700">ФОП / загальна система</span>
            </label>
          </div>
          {taxSystemSaved && (
            <div className="text-xs text-green-600 font-medium">Збережено</div>
          )}
        </div>
      )}

      {/* Archive / Delete */}
      <div className="flex items-center justify-center gap-6">
        <button
          onClick={handleArchiveToggle}
          disabled={archiveLoading}
          className="text-xs text-gray-400 hover:text-amber-600 disabled:opacity-50 transition underline underline-offset-2"
        >
          {archiveLoading
            ? 'Зачекайте…'
            : isArchived ? 'Розархівувати контрагента' : 'Архівувати контрагента'}
        </button>
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
