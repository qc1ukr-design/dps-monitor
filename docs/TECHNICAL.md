# DPS-Monitor — Технічна документація

> Останнє оновлення: 2026-04-03 (сесія 8)

---

## 1. Загальний опис проєкту

**DPS-Monitor** — веб-застосунок для моніторингу стану розрахунків, звітності та документообігу клієнтів у системі ДПС України (Електронний кабінет платника).

- **Фронтенд / SSR:** Next.js 14 (App Router), TypeScript, Tailwind CSS
- **База даних / Auth:** Supabase (PostgreSQL + Auth)
- **Деплой web:** Vercel (`dps-monitor.vercel.app`) — підключений до репо `qc1ukr-design/dps-monitor`
- **Backend:** Express.js (Node.js, TypeScript) — деплой на Railway (`dps-monitor-production.up.railway.app`); watchPatterns `["backend/**"]` → авто-деплой при push
- **Крипто КЕП:** бібліотека `jkurwa` (ДСТУ 4145, CAdES-BES) для підписання
- **Шифрування даних КЕП:** AWS KMS (CMK `dps-monitor-kep`, eu-central-1) — envelope encryption

> ⚠️ **Важливо:** `web-gold-rho-91.vercel.app` — старий ізольований деплой, **не підключений до GitHub**. Усі нові коміти йдуть тільки на `dps-monitor.vercel.app`.

---

## 2. Структура проєкту

```
DPS-Monitor/
├── web/                          # Next.js застосунок (Vercel)
│   ├── app/
│   │   ├── api/clients/[id]/
│   │   │   ├── route.ts          # GET/DELETE клієнта
│   │   │   ├── sync/             # POST — синхронізація з ДПС
│   │   │   ├── kep/              # POST upload / GET info КЕП
│   │   │   ├── token/            # POST — збереження UUID-токена
│   │   │   ├── documents/        # GET — вхідні документи
│   │   │   └── probe-reports/    # GET — діагностичний ендпоінт (debug)
│   │   ├── api/cron/             # Автоматична синхронізація (Vercel Cron)
│   │   ├── api/sync-all/         # POST — синхронізація всіх клієнтів
│   │   ├── api/export/           # GET — Excel-експорт
│   │   └── dashboard/
│   │       ├── page.tsx          # Список клієнтів
│   │       └── client/[id]/
│   │           ├── page.tsx      # Картка клієнта
│   │           ├── reports/      # Звітність (reg_doc/list)
│   │           ├── documents/    # Вхідні документи (post/incoming)
│   │           └── settings/     # Налаштування: КЕП, UUID-токен
│   └── lib/
│       ├── backend.ts            # HTTP-клієнт до backend (backendGetKep)
│       └── dps/
│           ├── signer.ts         # Підписання КЕП, читання сертифікату
│           ├── dps-auth.ts       # OAuth2 авторизація (всі методи)
│           ├── normalizer.ts     # Нормалізація відповідей ДПС API
│           ├── alerts.ts         # Логіка алертів (порівняння кешу)
│           ├── types.ts          # TypeScript типи
│           └── mock-data.ts      # Моковані дані для dev
├── backend/                      # Express.js сервіс (Railway)
│   └── src/
│       ├── lib/
│       │   ├── kmsClient.ts      # Низькорівневий AWS KMS (encrypt/decrypt/generateDataKey)
│       │   ├── kms.ts            # Envelope encryption (kmsEncrypt/kmsDecrypt/serialize)
│       │   └── aes.ts            # Legacy AES decrypt (iv:tag:ciphertext hex)
│       ├── services/
│       │   └── kepEncryptionService.ts  # Envelope encryption сервіс для kep_credentials
│       ├── routes/
│       │   ├── kep.ts            # GET /kep/:clientId (internal cron endpoint, X-Backend-Secret)
│       │   ├── kepCredentials.ts # POST/GET/DELETE /kep-credentials/* (internal, X-Backend-Secret + JWT)
│       │   ├── kepRoutes.ts      # POST/GET/DELETE /api/kep/* (user-facing, Supabase JWT)
│       │   └── kms.ts            # GET /kms/test (перевірка KMS connectivity)
│       └── middleware/
│           └── auth.ts           # requireApiSecret + requireCronSecret (HMAC constant-time порівняння)
├── supabase/                     # Міграції БД
└── docs/
    ├── TECHNICAL.md              # Цей файл
    └── ALERT_POLICY.md           # Політика алертів
```

---

## 3. Схема бази даних (Supabase)

| Таблиця | Призначення |
|---|---|
| `clients` | Клієнти (id, name, edrpou, user_id) |
| `api_tokens` | КЕП та UUID-токени (legacy + KMS envelope encryption) |
| `dps_cache` | Кеш відповідей ДПС (profile, budget, documents, archive_flag) |
| `alerts` | Алерти про зміни (борг, статус, нові документи, КЕП, stale sync) |
| `user_settings` | Налаштування користувача (telegram_chat_id, notify_telegram) |
| `kep_credentials` | Зашифровані КЕП-файли (міграція 005, envelope encryption per-KEP DEK) |
| `kep_access_log` | Аудит-лог операцій з КЕП (UPLOAD/USE_FOR_DPS/DELETE/VIEW_LIST/KEP_TEST) |

**Поля `api_tokens`:**
- `kep_encrypted` — зашифрований КЕП; підтримується два формати (auto-detect у backend):
  - **KMS envelope** (новий): base64(JSON `{ version:1, encryptedDek, iv, tag, ciphertext }`)
  - **Legacy AES** (старий): hex рядок `iv:tag:ciphertext` (AES-256-GCM, ключ `ENCRYPTION_KEY`)
- `kep_password_encrypted` — зашифрований пароль КЕП окремим KMS envelope (так само як `kep_encrypted`); backend читає і пише обидва поля незалежно
- `kep_tax_id` — **завжди РНОКПП** (serialNumber з сертифікату); використовується для підписання OAuth
- `token_encrypted` — UUID Bearer-токен (альтернативний метод, сесійний)

**Поле `clients.edrpou` — критично важливе для визначення типу клієнта:**
- Для **ЮО**: зберігається ЄДРПОУ (8 цифр) з `organizationIdentifier` сертифікату (OID 2.5.4.97)
- Для **ФО/ФОП**: зберігається РНОКПП (10 цифр) з `serialNumber` сертифікату
- Ознака ЮО в коді: `/^\d{8}$/.test(edrpou)` — якщо true → клієнт ЮО

---

## 4. DPS Cabinet API — Рівні доступу

Електронний кабінет має три рівні API з різними методами авторизації:

### 4.1 `ws/public_api` — публічний API з КЕП-підписом

**Авторизація:** заголовок `Authorization: <CAdES-BES підпис taxId в BASE64>`

Підпис генерується бібліотекою `jkurwa`:
- Алгоритм: ДСТУ 4145 (еліптичні криві)
- Формат: CAdES-BES з вбудованим сертифікатом і міткою часу
- Підписаний рядок: ЄДРПОУ (для ЮО) або РНОКПП (для ФО/ФОП)
- Час дії підпису: ~1 година

**Ендпоінти:**

| Ендпоінт | Метод | Ідентифікація платника | Статус |
|---|---|---|---|
| `payer_card` | GET | `organizationIdentifier` з cert ✓ | ✅ Працює для ЮО |
| `ta/splatp?year=Y` | GET | `organizationIdentifier` з cert ✓ | ✅ Працює для ЮО |
| `post/incoming?page=0&size=100` | GET | `organizationIdentifier` з cert ✓ | ✅ Працює для ЮО |
| `post/sent?page=0` | GET | `organizationIdentifier` з cert ✓ | ✅ Працює для ЮО |
| `reg_doc/list?periodYear=Y` | GET | `serialNumber` (РНОКПП) з cert ⚠️ | ⚠️ Повертає дані власника ключа |

> **Критичне відкриття (2026-03-31):** `reg_doc/list` ідентифікує платника за `serialNumber` (РНОКПП) сертифікату, а **не** за `organizationIdentifier` (ЄДРПОУ). Це означає, що при підписанні ЄДРПОУ ключем директора, ендпоінт все одно повертає **особисті звіти директора** (ФОП-декларації), а не звіти юридичної особи. Усі інші ендпоінти (`payer_card`, `ta/splatp`, `post/incoming`) правильно читають `organizationIdentifier`.

### 4.2 `ws/api` — приватний API з OAuth Bearer токеном

**Авторизація:** OAuth2 `grant_type=password`

```
POST https://cabinet.tax.gov.ua/ws/auth/oauth/token
  ?grant_type=password
  &username={taxId}-{taxId}-{timestamp_ms}
  &password={CAdES-BES підпис taxId в BASE64}

Header: Authorization: Basic QUU2ODY3NjY0Qz...  (статичний OAuth client_id:secret)
```

**Static OAuth client (знайдено в Angular bundle `chunk-Z2AFO2O6.js`):**
```
AE6867664C096C83E0530101007F45F4:AE6867664C096C83E0530101007F45F4
Base64: QUU2ODY3NjY0QzA5NkM4M0UwNTMwMTAxMDA3RjQ1RjQ6QUU2ODY3NjY0QzA5NkM4M0UwNTMwMTAxMDA3RjQ1RjQ=
```
Це ідентифікатор **застосунку** (Електронний кабінет), не користувача. Не змінюється.

**Ендпоінт звітності:** `GET /ws/api/regdoc/list?periodYear=Y&page=0&size=100&sort=dget,desc`

**Токен живе:** ~600 секунд (10 хвилин)

### 4.3 `ws/a` — Angular SPA API з UUID Bearer токеном

UUID-токен генерується при вході в браузерний кабінет. Видно в DevTools → Network.
Живе кілька годин. Не відновлюється програмно без браузера.

---

## 5. Методи авторизації для ЮО через ключ директора

### 5.1 Структура сертифікату директора ЮО

Сертифікат посадової особи містить:
- `serialNumber` (OID 2.5.4.5) → РНОКПП директора (10 цифр)
- `organizationIdentifier` (OID 2.5.4.97) → ЄДРПОУ організації (8 цифр), формат `ЄДРПОУ12345678` або `UA-E12345678`

Поле `organizationIdentifier` присутнє тільки в сертифікатах посадових осіб. У особистих сертифікатах ФО/ФОП — відсутнє.

**Функція витягу ЄДРПОУ з сертифікату** (`lib/dps/signer.ts`):
```typescript
export async function getCertOrgTaxId(kepDecrypted, password): Promise<string | null>
```

### 5.2 Випробувані OAuth-формати для ЮО

| # | Метод | username | password (підписаний рядок) | Результат |
|---|---|---|---|---|
| 1 | `loginWithKepAsYuo` | `{РНОКПП}-{ЄДРПОУ}-{ts}` | підписано РНОКПП | ❌ "Ви не маєте права підпису" |
| 2 | `loginWithKepAsYuoSignEdrpou` | `{РНОКПП}-{ЄДРПОУ}-{ts}` | підписано ЄДРПОУ | ❌ "Ви не маєте права підпису" |
| 3 | `loginWithKepStamp` | `{ЄДРПОУ}-{ЄДРПОУ}-{ts}` | підписано ЄДРПОУ печаткою | ❌ "no-stamp-cert" (немає печатки в файлі) |
| 4 | `loginWithKepAsYuoEdrpouFormat` | `{ЄДРПОУ}-{ЄДРПОУ}-{ts}` | підписано ЄДРПОУ ключем директора | ❌ "Не вірний податковий номер" |
| 5 | `loginWithKep` (ФО) | `{РНОКПП}-{РНОКПП}-{ts}` | підписано РНОКПП | ✅ Токен ФО-контексту (особисті дані) |

> **Висновок:** DPS перевіряє **реєстр уповноважених підписантів** для ЮО OAuth. Якщо директор не зареєстрований як уповноважена особа в системі ДПС (право підпису) — отримуємо "Ви не маєте права підпису". Це не залежить від формату підпису.

> **Примітка:** ФО OAuth (метод 5) повертає токен для ФО-контексту → `/ws/api/regdoc/list` з цим токеном дає особисті декларації директора. **Заборонено використовувати для ЮО-клієнтів** (є захист у коді: `if (!isYuo)`).

### 5.3 Що спрацювало для звітності ЮО

**Спостереження (2026-03-31):** При виклику `ws/api/regdoc/list` через **ФО OAuth токен** (РНОКПП-РНОКПП-ts) — для тестового клієнта АММОЛІТ ПЛЮС (ЄДРПОУ 44012570) — ендпоінт повернув **70 звітів ЮО** (форми J/S префікс), а не особисті звіти директора.

Це означає що `ws/api/regdoc/list` (на відміну від `ws/public_api/reg_doc/list`) використовує `organizationIdentifier` з сертифікату для визначення контексту — тобто поводиться **аналогічно до `payer_card`**.

**Підтверджено стабільність (2026-04-01):**
- АММОЛІТ ПЛЮС (ЄДРПОУ 44012570) — 17 звітів, всі J-форми ✅
- МАРЬЯНЕНКО (ЄДРПОУ 44544659) — 2 звіти, всі J-форми (J0500110) ✅
- Обидва клієнти після self-heal і після виправлення `from-kep` показують коректні ЮО звіти стабільно.

**Поточний робочий флоу для звітності ЮО:**
1. Спроба `ws/public_api/reg_doc/list` з підписом ЄДРПОУ
2. Якщо повернулися тільки F-форми (особисті ФО/ФОП) → пропустити, це дані директора
3. Перейти до ЮО OAuth методів (stamp → yuo → yuo-se)
4. Якщо OAuth відмовив → `loginWithKep` (ФО OAuth) → `ws/api/regdoc/list` → ЮО контекст через `organizationIdentifier` ✅

---

## 6. Фільтрація ФО-даних для ЮО-клієнтів

### 6.1 Код форм DPS

| Префікс | Тип | Приклад |
|---|---|---|
| `J` | Юридична особа | `J0100129` — декларація з податку на прибуток |
| `S` | Фінансова звітність ЮО | `S0100115` — баланс, `S0100311` — звіт про рух коштів |
| `F` | Фізична особа / ФОП | `F0103407` — декларація ФОП єдиного податку |

### 6.2 Захист від показу особистих даних директора

**Правило:** якщо клієнт є ЮО (ЄДРПОУ — 8 цифр) і **всі** повернуті форми мають F-префікс → результат ігнорується як неправильний (особисті дані директора).

```typescript
function isAllFoForms(reports: TaxReport[]): boolean {
  return reports.length > 0 && reports.every(r => r.formCode.toUpperCase().startsWith('F'))
}
```

Якщо ЮО-клієнт і немає жодного робочого методу → показується пояснення користувачу (замість помилки або неправильних даних).

---

## 7. Синхронізація (`/api/clients/[id]/sync`)

Синхронізує профіль і бюджет клієнта. Записує в `dps_cache`. Порівнює зі старими даними → генерує алерти.

**Ендпоінти ДПС при синку:**
- `payer_card` → `dps_cache.profile`
- `ta/splatp?year=Y` → `dps_cache.budget`

**Авторизація:** `ws/public_api` з підписом ЄДРПОУ (для ЮО) або РНОКПП (для ФО).

---

## 8. Завантаження КЕП нового клієнта (`/api/clients/from-kep`)

### 8.1 Два шляхи завантаження

| Сценарій | Функція | Поведінка `taxId` |
|---|---|---|
| Кілька файлів (ключ+сертифікат або директор+печатка) | `inspectKepFiles` | Автоматично замінює `taxId` на ЄДРПОУ якщо є `organizationIdentifier` |
| Один файл (pkcs12/jks/pfx) | `inspectKepWithCert` | Повертає `taxId` = РНОКПП (serialNumber), заповнює `orgTaxId` окремо |

### 8.2 Помилка "хибний підписант" при створенні нового ЮО-клієнта

**Симптом:** щойно створений клієнт (ЮО) при синхронізації повертає помилку "хибний підписант".

**Причина (виявлено 2026-03-31):** при завантаженні одного файлу КЕП, `from-kep/route.ts` раніше використовував:
```typescript
const edrpou = kepInfo.taxId || null  // ← bug: taxId = РНОКПП (10 цифр), не ЄДРПОУ
```
Це зберігало РНОКПП директора у `clients.edrpou` (10 цифр). При синхронізації: `isYuo = /^\d{8}$/.test(edrpou)` → `false` → підпис виконувався як ФО → ДПС відхиляло з "хибний підписант" (контекст ЮО не встановлено).

**Виправлення (2026-03-31):** `from-kep/route.ts` тепер використовує `orgTaxId` з пріоритетом:
```typescript
const edrpou = kepInfo.orgTaxId ?? kepInfo.taxId ?? null
```
- Якщо є `orgTaxId` (ЄДРПОУ, 8 цифр) → зберігається у `clients.edrpou` → `isYuo = true` ✅
- Якщо `orgTaxId` відсутній (ФО/ФОП сертифікат) → `taxId` (РНОКПП, 10 цифр) → `isYuo = false` ✅

**Важливо:** `kep_tax_id` завжди залишається `kepInfo.taxId` (РНОКПП) — він потрібний для OAuth-підписання (DPS OAuth перевіряє, що підписаний рядок відповідає `serialNumber` сертифікату).

### 8.3 Різниця між `inspectKepWithCert` і `inspectKepFiles`

`inspectKepFiles` (кілька файлів) автоматично виправляє `taxId` → `orgTaxId` для ЮО:
```typescript
if (/^\d{10}$/.test(info.taxId)) {
  const orgTaxId = extractOrgTaxId(box)
  if (orgTaxId) return { ...info, taxId: orgTaxId }  // taxId стає ЄДРПОУ
}
```

`inspectKepWithCert` (один файл) — не робить цієї заміни, повертає `taxId` = РНОКПП і `orgTaxId` окремо. Тому в `from-kep/route.ts` явно беремо `orgTaxId` з пріоритетом над `taxId`.

---

## 9. Відомі обмеження та нерозв'язані питання

### 9.1 reg_doc/list для ЮО без реєстрації підписанта

Якщо директор **не зареєстрований** як уповноважена особа в DPS-реєстрі підписантів:
- `ws/api` OAuth ЮО методи → "Ви не маєте права підпису"
- Обхід: `ws/api/regdoc/list` через ФО OAuth + `organizationIdentifier` у сертифікаті (дає ЮО контекст)

### 9.2 probe-reports / probe-docs ендпоінти

Діагностичні ендпоінти у `app/api/clients/[id]/probe-reports/` та `probe-docs/` — **404 на `web-gold-rho-91.vercel.app`** (старий деплой без git). На `dps-monitor.vercel.app` працюють.

### 9.3 Перемикач "Посадова особа / Фізична особа"

Браузерний Електронний кабінет при вході ключем директора показує тумблер:
- **Посадова особа** → ЮО-контекст
- **Фізична особа** → особистий контекст

Програмного ендпоінту для цього перемикання у відкритій документації немає. Ймовірно реалізовано через два різних OAuth-запити при вході (не через окремий switch-endpoint).

### 9.4 Печатка організації

`loginWithKepStamp` шукає stamp-сертифікат у файлі КЕП. Якщо файл КЕП містить тільки особистий ключ директора (без печатки організації) → `no-stamp-cert`. Печатка — окремий ключ, що видається організації (не фізособі). Якщо б він був доступний → ЮО OAuth через `ЄДРПОУ-ЄДРПОУ-ts` спрацював би напряму.

---

## 10. Crypto / КЕП

### 10.1 Підтримувані формати КЕП

| Формат | Опис |
|---|---|
| `.pfx` / `.p12` | PKCS#12, base64 |
| `.jks` | Java KeyStore |
| `.dat` / `Key6.dat` | M.E.Doc формат |
| JSON v2 | Власний формат (зашифрований AES, кілька ключів в одному файлі) |

### 10.2 Структура JSON v2 КЕП

```json
{
  "version": 2,
  "keys": [
    { "role": "sign", "key": "<base64>", "cert": "<base64>" },
    { "role": "stamp", "key": "<base64>", "cert": "<base64>" }
  ]
}
```

### 10.3 Ключові функції signer.ts

| Функція | Опис |
|---|---|
| `signWithKepDecrypted(kep, pwd, taxId)` | Підписує taxId → CAdES-BES base64 (для Authorization header) |
| `getCertTaxId(kep, pwd)` | Витягує РНОКПП з сертифікату (serialNumber) |
| `getCertOrgTaxId(kep, pwd)` | Витягує ЄДРПОУ організації з сертифікату (organizationIdentifier, OID 2.5.4.97) |
| `getStampCertTaxId(kep, pwd)` | Витягує ЄДРПОУ з печатки (якщо є в файлі) |
| `diagnoseBox(kep, pwd)` | Повна діагностика: список ключів, тип, taxId, orgTaxId, АЦСК |
| `extractCertInfo(cert)` | Парсить ASN.1 сертифікат → `KepInfo` (ім'я, АЦСК, термін, taxId, orgTaxId) |

---

## 11. Backend-сервіс (Railway) і шифрування КЕП через AWS KMS

### 11.1 Архітектура

Весь процес зберігання і розшифрування КЕП-даних делегований окремому Express-сервісу на Railway. Web (Vercel) ніколи не шифрує і не розшифровує КЕП самостійно — тільки звертається до backend через HTTP.

```
[Web / Vercel]  →  POST /kep/upload  →  [Backend / Railway]  →  AWS KMS CMK  →  Supabase
[Web / Vercel]  →  GET /kep/:id      →  [Backend / Railway]  →  AWS KMS CMK  →  Supabase
```

Аутентифікація між web і backend: заголовок `X-Backend-Secret` (спільний секрет `BACKEND_API_SECRET`).

### 11.2 AWS KMS — налаштування

| Параметр | Значення |
|---|---|
| Тип ключа | Symmetric, SYMMETRIC_DEFAULT (AES-256-GCM) |
| Alias | `dps-monitor-kep` |
| Регіон | `eu-central-1` |
| IAM user | Мінімальні права: тільки `kms:Encrypt`, `kms:Decrypt`, `kms:GenerateDataKey` на конкретний Key ARN |

### 11.3 Envelope Encryption

KMS не шифрує дані напряму (обмеження AWS: max 4 KB). Використовується envelope encryption:

1. `GenerateDataKey` → отримуємо **DEK** (Data Encryption Key) у двох видах: plaintext + encrypted
2. Шифруємо КЕП-дані локально через AES-256-GCM за допомогою plaintext DEK
3. Зберігаємо в БД: `encryptedDek` (зашифрований KMS) + `iv` + `tag` + `ciphertext`
4. Plaintext DEK не зберігається ніде

**Структура KMS envelope (після `serializeEnvelope()` → base64 JSON):**
```json
{
  "version": 1,
  "encryptedDek": "<base64>",
  "iv": "<base64>",
  "tag": "<base64>",
  "ciphertext": "<base64>"
}
```

### 11.4 Auto-detect: KMS envelope vs legacy AES

Функція `isKmsEnvelope(stored: string): boolean` у `backend/src/lib/kms.ts`:
```typescript
function isKmsEnvelope(stored: string): boolean {
  try {
    const decoded = Buffer.from(stored, 'base64').toString('utf8')
    const parsed = JSON.parse(decoded)
    return parsed?.version === 1
  } catch {
    return false
  }
}
```

`decryptStored(stored)` маршрутизує до `kmsDecrypt` або `aesDecrypt` автоматично. Міграція даних не потрібна — обидва формати читаються прозоро.

### 11.5 Backend API

| Метод | Шлях | Auth | Опис |
|---|---|---|---|
| `GET` | `/kep/:clientId` | X-Backend-Secret | Читає активний КЕП з `kep_credentials`, розшифровує, повертає `{ kepData, password }`. Викликається cron sync-all. `userId` читається з рядка БД — не з запиту. |
| `POST` | `/kep-credentials/upload` | X-Backend-Secret + JWT | Шифрує і зберігає КЕП у `kep_credentials` (per-KEP DEK). Перевіряє ownership клієнта. |
| `GET` | `/kep-credentials/by-client/:clientId` | X-Backend-Secret + JWT | Розшифровує активний КЕП за clientId (IDOR-захист через userId). |
| `POST` | `/api/kep/upload` | Supabase JWT | User-facing: завантажити КЕП (multipart, max 5 MB, 10 req/год). |
| `GET` | `/api/kep/list` | Supabase JWT | Список КЕП поточного юзера (metadata only, без blob). |
| `DELETE` | `/api/kep/:id` | Supabase JWT | Видалити КЕП (20 req/год). |
| `POST` | `/api/kep/:id/test` | Supabase JWT | Тест розшифровки — пише `KEP_TEST` в audit log (20 req/год). |
| `GET` | `/kms/test` | X-Backend-Secret | Перевіряє KMS connectivity: `generateDataKey` + `encrypt` + `decrypt`. |

### 11.6 `web/lib/backend.ts`

```typescript
export async function backendGetKep(clientId: string): Promise<{ kepData: string; password: string }>
```

Використовується у:
- `web/app/api/clients/[id]/sync/route.ts`
- `web/app/api/cron/sync-all/route.ts`

Timeout: 10 секунд. Кидає `Error` при non-2xx або timeout.

### 11.7 `backend/src/services/kepEncryptionService.ts` — Envelope Encryption сервіс

Реалізує повний цикл збереження/читання КЕП для таблиці `kep_credentials` (міграція 005). Відрізняється від `routes/kep.ts` (який пише в `api_tokens`): новий сервіс — окрема таблиця з окремим DEK на кожен КЕП.

**Публічний API:**

| Функція | Опис |
|---|---|
| `encryptKep(params)` | Генерує DEK, шифрує файл і пароль окремо, зануляє DEK, записує в `kep_credentials`. Повертає `KepCredential` (метадані, без blob-ів) |
| `decryptKep(kepId, userId, action?)` | Розшифровує DEK через KMS, розшифровує KEP + пароль, зануляє DEK, повертає `{ kepFileBuffer, kepPassword, cleanup }`. `action` — тип у audit log (`'USE_FOR_DPS'` за замовчуванням, або `'KEP_TEST'` для тестових розшифровок) |
| `decryptKepByClientId(clientId, userId)` | Розшифровує активний КЕП за clientId з перевіркою userId (IDOR-захист). Для JWT-authenticated маршрутів. |
| `decryptKepByClientIdInternal(clientId)` | Читає `user_id` з рядка БД — не приймає userId від caller. Для internal cron маршруту (P5 fix). |
| `deleteKep(kepId, userId)` | Hard delete з перевіркою ownership; аудит-лог зберігається (`ON DELETE SET NULL`) |
| `listKeps(userId)` | SELECT тільки метаданих (без blob-ів); повертає `KepMetadata[]` |

**Схема шифрування:**

```
encryptKep():
  KMS.generateDataKey() → { DEK plaintext, DEK encrypted }
  aesGcmEncrypt(kepFileBuffer, DEK) → encrypted_kep_blob
  aesGcmEncrypt(password,     DEK) → encrypted_password_blob
  DEK.fill(0)                       ← знищення в пам'яті
  INSERT kep_credentials(blobs, encrypted_dek, kms_key_id, metadata)

decryptKep():
  SELECT WHERE id=kepId AND user_id=userId AND is_active=true
  KMS.decrypt(encrypted_dek) → DEK
  aesGcmDecrypt(encrypted_kep_blob,      DEK) → kepFileBuffer
  aesGcmDecrypt(encrypted_password_blob, DEK) → passwordBuffer
  DEK.fill(0)                       ← знищення
  return { kepFileBuffer, kepPassword, cleanup }
  // cleanup() → kepFileBuffer.fill(0) + passwordBuffer.fill(0)
```

**Формат blob:** `<iv_base64>:<tag_base64>:<ciphertext_base64>` (base64 економить 33% проти hex для великих файлів).

**Гарантії безпеки:**
- Plaintext КЕП і пароль **ніколи** не зберігаються в БД
- DEK зануляється у всіх шляхах виконання (success + catch)
- `cleanup()` зануляє `kepFileBuffer` і `passwordBuffer`; JS string `kepPassword` — immutable (не може бути занулений — обмеження V8), але підлеглий `passwordBuffer` зануляється
- `console.log` / логи не містять КЕП, пароль або DEK
- Кожна операція логується в `kep_access_log` без sensitive-даних
- `listKeps()` SELECT явно не вибирає blob-колонки
- `last_used_at` update містить `user_id` фільтр (defense-in-depth)

**Правильний патерн виклику (caller відповідальність):**
```typescript
const kep = await decryptKep(kepId, userId)
try {
  await signDpsRequest(kep.kepFileBuffer, kep.kepPassword)
} finally {
  kep.cleanup()  // обов'язково в finally — навіть якщо підписання кинуло помилку
}
```

**Аудит-лог (`kep_access_log`):**
- INSERT дозволений для `authenticated` (RLS policy)
- SELECT заблокований для всіх ролей — тільки `service_role` (backend) читає через bypass RLS
- `error_message` зберігає тільки системне повідомлення помилки, ніяких даних КЕП

---

## 12. Нормалізація відповідей DPS API

DPS повертає дані у двох форматах:

**Груповий формат** (`payer_card`):
```json
[
  { "idGroup": 1, "title": "Реєстраційні дані", "values": { "FULL_NAME": "...", "TIN": "..." } },
  { "idGroup": 2, "title": "Види діяльності", "listValues": [...] }
]
```

**Плоский формат** (`ta/splatp`, `regdoc/list`):
```json
[
  { "namePlt": "ЄП", "narah0": 1000, "splbd0": 800, "debtAll": 200 }
]
```

**Spring Boot Page** (`regdoc/list` через OAuth):
```json
{ "content": [...], "totalElements": 70, "size": 100, "number": 0 }
```

Всі формати обробляє `lib/dps/normalizer.ts`.

---

## 12. Алерти

Логіка в `lib/dps/alerts.ts`. Порівнює `oldProfile`/`oldBudget` з `newProfile`/`newBudget` після синку.

**Типи алертів (`AlertType`):**

| Тип | Опис | Дедуплікація |
|---|---|---|
| `debt_change` | Зміна суми боргу | — |
| `overpayment` | Нова переплата | — |
| `status_change` | Зміна статусу платника | — |
| `new_document` | Новий вхідний документ | — |
| `kep_expiring` | КЕП закінчується (< 30 днів) | 6 днів |
| `kep_expired` | КЕП прострочено | 6 днів |
| `sync_stale` | Синхронізація не виконується > 48 год | 6 днів |

Email-нотифікації: `lib/email.ts` (fire-and-forget, не блокує синк).
Telegram-нотифікації: `lib/telegram.ts` — кидає помилку при non-2xx від Telegram API.

Детальна політика: `docs/ALERT_POLICY.md`.

---

## 13. Dashboard — фільтри, сортування, архів

### 13.1 ClientsTable (`web/app/dashboard/clients-table.tsx`)

`'use client'` компонент з `useMemo` для фільтрації/сортування:
- **Пошук** за назвою клієнта (рядок пошуку)
- **Швидкі фільтри** (таблетки): Всі / З боргом / Не оновлюються
- **Сортування** по колонках: назва, борг, остання синхронізація, КЕП до
- **Архівні клієнти** виведені окремою секцією внизу з кнопкою розархівування

### 13.2 Архівування клієнтів

Архів зберігається в `dps_cache` без змін DDL:
```
data_type = 'archive_flag'
data      = { "archived": true }
```

**API:** `PATCH /api/clients/[id]`
- `{ is_archived: true }` → upsert рядка `archive_flag` в `dps_cache`
- `{ is_archived: false }` → delete рядка `archive_flag` з `dps_cache`

Сторінка налаштувань клієнта (`/dashboard/client/[id]/settings`) містить кнопку "Архівувати / Розархівувати контрагента". При архівуванні — перенаправляє на `/dashboard`.

### 13.3 Stale sync detection у UI

`isSyncStale = hasKep && (!lastSynced || вік > 48 год)` — рядок підсвічується бурштиновим кольором у таблиці.

---

## 14. Cron-задачі (`vercel.json`)

| Шлях | Розклад | Опис |
|---|---|---|
| `/api/cron/sync-all` | `0 4 * * *` | Щоденно о 04:00 UTC — синхронізація всіх клієнтів з ДПС, генерація алертів, перевірка КЕП і stale sync |
| `/api/cron/weekly-digest` | `0 8 * * 1` | Щопонеділка о 08:00 UTC (11:00 Київ) — тижневий дайджест у Telegram |

### 14.1 sync-all (`/api/cron/sync-all`)

Для кожного клієнта з KEP:
1. Викликає backend `GET /kep/:clientId` → отримує розшифрований КЕП і пароль; підписує, отримує `payer_card` + `ta/splatp` + `post/incoming`
2. Порівнює з кешем → вставляє алерти в `alerts`
3. Відправляє Telegram + email якщо є нові алерти
4. Перевіряє `kep_valid_to` → `kep_expiring`/`kep_expired` алерти (дедуп 6 днів)
5. Для клієнтів, що не синхронізувались > 48 год → `sync_stale` алерт (дедуп 6 днів)

### 14.2 weekly-digest (`/api/cron/weekly-digest`)

Для кожного користувача з `notify_telegram = true`:
- Збирає активних (не архівованих) клієнтів
- Будує три списки: клієнти з боргом > 1 грн / з stale sync / з KEP < 30 днів
- Відправляє Telegram-повідомлення з HTML-форматуванням та посиланням на dashboard

Telegram-тільки (email не використовується — RESEND_API_KEY необов'язковий).

---

## 15. Змінні середовища

### 15.1 Web (Vercel)

| Змінна | Призначення |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL Supabase проєкту |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key Supabase (`sb_publishable_...`, замінює legacy JWT anon key) |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key Supabase (`sb_secret_...`, замінює legacy JWT service_role; для cron/server-side) |
| `BACKEND_URL` | URL backend-сервісу на Railway (`https://dps-monitor-production.up.railway.app`) |
| `BACKEND_API_SECRET` | Спільний секрет для `X-Backend-Secret` header (64 hex символи) |
| `EMAIL_FROM` / `RESEND_API_KEY` | Email-нотифікації (необов'язково — якщо не задано, email тихо пропускається) |
| `TELEGRAM_BOT_TOKEN` | Токен Telegram-бота для нотифікацій |
| `CRON_SECRET` | Секрет для захисту cron-ендпоінтів (`Authorization: Bearer <secret>`) |

### 15.2 Backend (Railway)

| Змінна | Призначення |
|---|---|
| `BACKEND_API_SECRET` | Той самий секрет, що у Vercel — перевіряється в `requireApiSecret` middleware |
| `AWS_ACCESS_KEY_ID` | IAM user з правами тільки на KMS операції |
| `AWS_SECRET_ACCESS_KEY` | Secret для IAM user |
| `AWS_REGION` | `eu-central-1` |
| `AWS_KMS_KEY_ID` | ARN або alias CMK (`alias/dps-monitor-kep`) |
| `SUPABASE_URL` | URL Supabase проєкту |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key Supabase (`sb_secret_...`, для upsert/select `api_tokens`) |

> ⚠️ Ніколи не комітити `.env` з реальними значеннями. Всі секрети зберігаються виключно в Railway Dashboard і Vercel Environment Variables. `.gitignore` блокує всі варіанти `.env` і `.env.local` рекурсивно.

---

## 16. Хронологія ключових рішень

| Дата | Проблема | Рішення |
|---|---|---|
| 2026-03 | Звіти ЮО показували особисту декларацію ФОП директора | Додано `isAllFoForms()` — фільтр F-форм для ЮО-клієнтів |
| 2026-03 | Неправильний URL ендпоінту звітності | `regdoc/list` → `reg_doc/list` (з підкресленням) згідно офіц. документації |
| 2026-03 | `organizationIdentifier` не читався з сертифікату | Додано парсинг OID 2.5.4.97 у `extractCertInfo`, нова функція `getCertOrgTaxId` |
| 2026-03 | ЮО OAuth всі методи → "Ви не маєте права підпису" | Директор АММОЛІТ ПЛЮС не в реєстрі підписантів ДПС; обхід через ФО OAuth + organizationIdentifier |
| 2026-03 | `probe-reports` ендпоінт 404 | Старий деплой `web-gold-rho-91.vercel.app` не підключений до git; правильний домен — `dps-monitor.vercel.app` |
| 2026-03 | Нові ЮО-клієнти (один файл КЕП) → "хибний підписант" | `from-kep/route.ts` зберігав РНОКПП у `clients.edrpou` замість ЄДРПОУ; виправлено на `kepInfo.orgTaxId ?? kepInfo.taxId` |
| 2026-03 | Існуючі ЮО-клієнти з неправильним `edrpou` (МАРЬЯНЕНКО) | `sync/route.ts` самовиправляє: якщо `edrpou` = 10 цифр → читає `orgTaxId` з сертифікату → оновлює БД → успішно синкає |
| 2026-03 | Vercel build failure — всі деплої падали з TypeScript помилкою | `yuoNoAccess` оголошено в типі `ReportsTable` props, але не включено в деструктурування; збірка падала з `Cannot find name 'yuoNoAccess'` |
| 2026-04-01 | **Верифікація:** МАРЬЯНЕНКО self-heal ✅ | Перший sync після деплою: `edrpou` виправлено `2978405747` → `44544659`, профіль і бюджет завантажено, J-форми звітів відображаються |
| 2026-04-01 | **Верифікація:** ФО OAuth → ЮО звіти стабільні ✅ | АММОЛІТ ПЛЮС: 17 J-форм; МАРЬЯНЕНКО: 2 J-форми — механізм `ws/api/regdoc/list` через ФО OAuth підтверджено стабільним |
| 2026-04-01 | Алерти про закінчення КЕП | Cron перевіряє `kep_valid_to` після синку; якщо < 30 днів → Telegram + email + alert у БД (дедуплікація: 6 днів); типи `kep_expiring`/`kep_expired` додано до `AlertType` |
| 2026-04-01 | Dashboard: колонка "КЕП до" | У таблиці контрагентів додано колонку "КЕП до" з кольоровим індикатором (червоний=прострочено, помаранчевий=< 30 днів). Окрему секцію "Строки дії КЕП" видалено — достатньо колонки в основній таблиці |
| 2026-04-01 | Excel: колонка "КЕП дійсний до" у зведеному звіті | Sheet 1 "Зведений звіт" розширено до 8 колонок; додано "КЕП дійсний до" з кольоровим заливанням (червоний/помаранчевий) за тим самим правилом < 30 днів |
| 2026-04-01 | Виправлення `kep_valid_to = null` | `extractCertInfo` читала `cert.validity.notAfter` (ASN.1 об'єкт `{ type, value }`) замість `cert.valid.to` (Unix timestamp). Виправлено на `cert.valid.{from,to}`. Додано `getCertValidTo()` + backfill у sync/route.ts для вже існуючих клієнтів |
| 2026-04-01 | Dashboard: фільтри, сортування, архів | Новий `clients-table.tsx` (`'use client'`) з пошуком, фільтр-таблетками та сортуванням по колонках. Архів без DDL — через `dps_cache` з `data_type='archive_flag'`. Кнопка архівування у налаштуваннях клієнта. |
| 2026-04-01 | Stale sync алерт у cron | `sync-all` після основного циклу перевіряє клієнтів що не синхронізувались > 48 год → `sync_stale` алерт + Telegram + email (дедуп 6 днів) |
| 2026-04-01 | Тижневий Telegram-дайджест | Новий ендпоінт `/api/cron/weekly-digest` (Пн 08:00 UTC). Збирає борги/stale/KEP проблеми по кожному користувачу → Telegram HTML. Email не використовується (RESEND_API_KEY відсутній у проєкті). |
| 2026-04-01 | `dps-monitor.vercel.app` вказував на старий деплой | Аліас `dps-monitor.vercel.app` вказував на `dps-monitor-3vsmv7bob` (ізольований старий). Виправлено: `vercel alias set web-h6c8nrpfe-... dps-monitor.vercel.app` |
| 2026-04-01 | `sendTelegramMessage` — видима помилка | Тепер кидає `Error(Telegram ${status}: ...)` на non-2xx замість тихого ігнорування |
| 2026-04-01 | **Міграція КЕП на AWS KMS** | Створено CMK `dps-monitor-kep` (eu-central-1, Symmetric). IAM user з мінімальними правами (тільки `kms:Encrypt/Decrypt/GenerateDataKey` на цей ARN). Backend (`kmsClient.ts`, `kms.ts`, `routes/kep.ts`) реалізує envelope encryption. Web делегує encrypt/decrypt backend через `backendGetKep()` і `POST /kep/upload`. Auto-detect формату у backend: KMS envelope (base64 JSON v1) або legacy AES (hex). Міграція даних не потрібна — обидва формати читаються прозоро. |
| 2026-04-01 | **End-to-end верифікація KMS** | `GET /kms/test` → `{success:true, checks:{generateDataKey,encrypt,decrypt}: "ok"}`. Реальний KEP (legacy AES у БД) успішно розшифрований через backend auto-detect. Cron `sync-all`: 6/6 клієнтів синхронізовано, errors: 0. |
| 2026-04-01 | **Міграція KEP AES → KMS (всі записи)** | `scripts/migrate-kep-to-kms.mjs` — 6/6 `kep_encrypted` записів перемігровано на KMS envelope encryption. `token_encrypted` очищено (NULL). `from-kep/route.ts` рефакторено: encrypt тепер виключно через backend (`POST /kep/upload`), пряме AES (`encrypt()`) видалено. |
| 2026-04-01 | **Ротація всіх витоклих секретів** | Виявлено `.env.local` з реальними секретами у git-репозиторії. Ротовано (всі платформи): `CRON_SECRET`, `TOKEN_ENCRYPTION_KEY`, `TELEGRAM_BOT_TOKEN`. `NEXT_PUBLIC_SUPABASE_ANON_KEY` → новий publishable key `sb_publishable_...`. `SUPABASE_SERVICE_ROLE_KEY` → новий secret key `sb_secret_...`. `.gitignore` розширено для блокування всіх варіантів `.env`. Vercel і Railway перезапущені з новими змінними. |
| 2026-04-02 | **Міграція 005: `kep_credentials` + `kep_access_log`** | Виконано в Supabase SQL Editor. Таблиця `kep_credentials` — окреме зберігання зашифрованих КЕП з полями `encrypted_kep_blob`, `encrypted_password_blob`, `encrypted_dek`, `kms_key_id`. RLS: 4 polícy (owner select/insert/update/delete). `kep_access_log` — аудит-лог (INSERT для authenticated, SELECT заблоковано). Тригер `set_updated_at`, часткові індекси. |
| 2026-04-02 | **`kepEncryptionService.ts` — Envelope Encryption сервіс** | `backend/src/services/kepEncryptionService.ts`. Функції: `encryptKep`, `decryptKep`, `deleteKep`, `listKeps`. Один унікальний DEK на кожен КЕП. DEK зануляється у всіх code paths. `cleanup()` callback для знищення розшифрованих Buffer-ів після підписання. Аудит кожної операції в `kep_access_log`. Жодного plaintext у БД або логах. Виправлено під час code review: `last_used_at` UPDATE отримав `user_id` фільтр (defense-in-depth); виправлено misleading коментар щодо zeroing JS string. |
| 2026-04-02 | **Міграція 006: `client_id` FK у `kep_credentials`** | Виконано в Supabase SQL Editor. Додано: `client_id uuid references clients(id)` (nullable до backfill), індекс `kep_credentials_client_id_idx`, partial unique index `kep_credentials_one_active_per_client` (`WHERE is_active=true AND client_id IS NOT NULL`) — один активний КЕП на клієнта на рівні БД. |
| 2026-04-02 | **`/kep-credentials` route + dual-read fallback** | Створено `backend/src/routes/kepCredentials.ts` (POST upload / GET by-client / GET by-id / DELETE / GET list). Зареєстровано в `routes/index.ts`. `kepEncryptionService` отримав `clientId?` в `encryptKep` і нову функцію `decryptKepByClientId`. Оновлено `GET /kep/:clientId` у `routes/kep.ts`: спочатку читає з `kep_credentials`, при відсутності — fallback на `api_tokens`. Додано `backendUploadKepCredential()` у `web/lib/backend.ts`. Створено `scripts/backfill-kep-credentials.mjs` (idempotent). |
| 2026-04-02 | **Backfill `api_tokens` → `kep_credentials` виконано** | `node scripts/backfill-kep-credentials.mjs` — 6/6 перенесено, 0 помилок. Усі записи тепер мають per-KEP DEK у `kep_credentials`. `api_tokens` збережено як fallback. |
| 2026-04-02 | **Public KEP REST API (`/api/kep/*`)** | Новий `backend/src/routes/kepRoutes.ts`. Auth: Supabase JWT (`Authorization: Bearer`), а не `X-Backend-Secret`. Endpoints: POST upload (multer, 5 MB, rate limit 10/год), GET list, DELETE, POST test. CORS розширено: додано `DELETE` і `Authorization`. Знайдено і виправлено баг: multer `LIMIT_FILE_SIZE` давав 500 замість 413 — додано `multerSingle()` wrapper. |
| 2026-04-02 | **End-to-end тестування KEP REST API** | 13 тестів на production: auth enforcement, валідація полів, upload/list/delete/test повний цикл, ізоляція між юзерами, file size limit. Всі пройдено ✅. Деталі — §18. |
| 2026-04-02 | **Security audit + виправлення 9 вразливостей (сесія 7)** | Проведено повний security audit архітектури КЕП. Знайдено 19 проблем (4 критичні, 5 високих, 5 середніх, 5 низьких). Виправлено 9: **C-1/C-2** — `kmsEncrypt` і `kmsDecrypt` обгорнуто в `try/finally` — DEK тепер гарантовано зануляється при будь-якій помилці; **C-3** — порівняння `X-Backend-Secret` і `CRON_SECRET` замінено з `!==` на `crypto.timingSafeEqual()` (захист від timing attack); **H-1** — `.single()` в `decryptKepByClientId` замінено на `.limit(1).order('created_at', desc)` (не падає при >1 записі); **H-2** — реалізовано безпечну заміну КЕП: нова функція `activateKep()`, новий КЕП зберігається як `is_active=false`, потім атомарно активується — клієнт ніколи не лишається без активного КЕП; **H-4** — `err.message` прибрано з усіх HTTP 500-відповідей, замінено на generic Ukrainian повідомлення, деталі логуються тільки в Railway; **M-3** — додано `sensitiveOpRateLimit` (20/год) на `DELETE /api/kep/:id` і `POST /api/kep/:id/test`; **M-5** — `errorHandler.ts` більше не повертає stack trace в HTTP відповідях. Коміт: `6dc6bd9`, задеплоєно на Railway. |
| 2026-04-02 | **Міграція kep_credentials: кроки C→E завершено** | **Крок C** (верифікація): cron sync-all 6/6 OK, `kep_access_log` — 7 записів `USE_FOR_DPS`, нуль fallback. **Крок D** (upload перемкнуто): `kep/route.ts` тепер викликає `backendUploadKepCredential()` з JWT + kepInfo metadata. **Крок E** (міграція 008): `client_id SET NOT NULL`, cert-metadata колонки (ca_name, owner_name, org_name, tax_id, valid_to), fallback на `api_tokens` видалено з `GET /kep/:clientId`. |
| 2026-04-03 | **Security audit P1–P5 (сесія 8): всі вразливості закрито** | 22 Jest-тести у `kepSecurity.test.ts`. **P1** — `railway.toml` hardening comment (Node.js heap memory window). **P2.1** — ownership check `clients.user_id` у `POST /kep-credentials/upload` (захист від KEP substitution attack). **P3.1** — `aes.ts`: `key.fill(0)` у `finally` після scrypt. **P3.2** — KMS singleton: `getClient()` з `kmsClient.ts` — видалено дублікат у `kms.ts`. **P3.3** — CORS: видалено мертвий заголовок `X-User-Id`. **P3.4** — `decryptKep` отримав optional `action` param; `POST /api/kep/:id/test` пише `KEP_TEST` в audit log (не `USE_FOR_DPS`); міграція 010 виконана. **P4.1** — rate limit 100→30 req/min/IP. **P5.1** — test UUID v4 у `kepSecurity.test.ts`. **P5.2** — utf8/jkurwa коментар у `GET /kep/:clientId`. **P5.3** — HMAC-SHA256 constant-time порівняння в `auth.ts` (усуває length-timing leak). Коміт `8dcdd6c`, задеплоєно на Railway + Vercel. |
| 2026-04-03 | **Cleanup: мертвий код видалено, документацію оновлено** | Прибрано comment-некролог `NOTE: POST /kep/upload was removed` з `kep.ts`. TECHNICAL.md оновлено до поточного стану (сесія 8). CLAUDE.md: міграція kep_credentials позначена як 100% завершена. |

---

## 17. Поточний стан системи (станом на 2026-04-03, сесія 8)

### ✅ Повністю завершено і стабільно

| Область | Стан |
|---|---|
| **Шифрування КЕП** | 100% KMS envelope encryption. Всі 6 записів у `api_tokens` мігровано. Новий сервіс `kepEncryptionService.ts` — per-KEP DEK для `kep_credentials`. |
| **`kep_credentials` + `kep_access_log`** | Таблиці створено (міграції 005+006). RLS активний. Route `/kep-credentials` задеплоєно. Dual-read fallback активний. Backfill виконано: 6/6 записів перенесені з `api_tokens`. |
| **Public KEP REST API** | `/api/kep/*` задеплоєно. Supabase JWT auth. End-to-end протестовано (13 тестів). Готово до підключення з фронтенду/мобільного. |
| **Backend (Railway)** | Express.js сервіс запущений. KMS connectivity підтверджено (`/kms/test`). Авто-деплой при push у `backend/**`. |
| **Синхронізація (cron)** | `sync-all` щодня о 04:00 UTC. Остання перевірка: 6/6 клієнтів OK, 0 помилок. |
| **Алерти** | Борг, статус, нові документи, КЕП expiry (30 днів), stale sync (48 год) — всі типи реалізовані та задеплоєні. |
| **Telegram-нотифікації** | Бот `8716647020` активний. Щоденні алерти + тижневий дайджест (пн 08:00 UTC). |
| **Dashboard** | Таблиця з фільтрами/сортуванням/архівом. Колонка "КЕП до" з кольоровим індикатором. |
| **Excel-експорт** | 8 колонок у зведеному звіті, включаючи "КЕП дійсний до" з кольором. |
| **Безпека секретів** | Всі секрети ротовано після виявлення витоку. `.gitignore` захищає від повторення. Supabase мігровано на новий формат ключів (`sb_publishable_` / `sb_secret_`). |
| **Security audit КЕП** | Два повних аудити (сесії 7 та 8). Всього 22 Jest-тести. **Нуль відкритих вразливостей.** Остання серія P1–P5 закрита в коміті `8dcdd6c` (2026-04-03). Деталі — §16 хронологія 2026-04-02 та 2026-04-03. |

### 🌐 Продакшн URL

| Сервіс | URL | Статус |
|---|---|---|
| Web (Vercel) | `https://dps-monitor.vercel.app` | ✅ Online |
| Backend (Railway) | `https://dps-monitor-production.up.railway.app` | ✅ Online |
| Supabase | `https://zvvvgjmyecabhugvkyjz.supabase.co` | ✅ Active |

> **Авто-деплой:** `dps-monitor` Vercel-проект підключений до GitHub (`qc1ukr-design/dps-monitor`, гілка `main`, rootDir `web`). Кожен `git push origin main` автоматично тригерить деплой. `vercel deploy --prod` вручну більше не потрібен.

### 🔑 Поточні ключі (формат, не значення)

| Ключ | Формат | Де зберігається |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_...` (новий Supabase формат) | Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_...` (новий Supabase формат) | Vercel + Railway |
| `TELEGRAM_BOT_TOKEN` | `8716647020:AAE...` (ротовано 2026-04-01) | Vercel |
| `CRON_SECRET` | 64 hex символи (ротовано 2026-04-01) | Vercel + Railway |
| `TOKEN_ENCRYPTION_KEY` | 64 hex символи (ротовано 2026-04-01) | Vercel + Railway |
| `AWS_KMS_KEY_ID` | `arn:aws:kms:eu-central-1:826496717510:key/17fd8a9a-...` | Railway |

### 🚦 Наступні кроки (в порядку виконання)

> Міграцію `kep_credentials` завершено повністю (всі кроки A→E). Система повністю на новій архітектурі.

- [x] **Крок A** — Deploy backend з `kepCredentials.ts` ✅
- [x] **Крок B** — Backfill: 6/6 перенесено ✅
- [x] **Крок C** — Верифікація: cron sync-all 6/6 OK, 7 записів `USE_FOR_DPS` в audit log ✅
- [x] **Крок D** — Upload перемкнуто: `backendUploadKepCredential()` з JWT + kepInfo ✅
- [x] **Крок E** — Міграція 008: `client_id NOT NULL`, cert-metadata колонки, fallback видалено ✅

---

### 💡 Відкладені задачі (не блокують поточний функціонал)

- **npm вразливості** — 4 вразливості потребують Next.js 14→16 (breaking change); відкладено.
- **Нові функції** — за потребою замовника

---

## 18. Public KEP REST API (`/api/kep/*`)

Файл: `backend/src/routes/kepRoutes.ts`. Зареєстровано в `routes/index.ts` як `router.use('/api/kep', kepRoutesRouter)`.

**Відрізняється від `/kep` і `/kep-credentials`:** ті захищені `X-Backend-Secret` (internal service), цей — відкритий для браузера/мобільного через Supabase JWT.

### 18.1 Аутентифікація

```
Authorization: Bearer <supabase-access-token>
```

Middleware `authMiddleware` викликає `supabase.auth.getUser(token)` → зберігає `userId` у `res.locals.userId`. При невалідному або відсутньому токені → 401.

### 18.2 Endpoints

| Метод | Шлях | Опис | Вхідні дані |
|---|---|---|---|
| `POST` | `/api/kep/upload` | Завантажити і зашифрувати КЕП | multipart/form-data: `file` (max 5MB), `password`, `clientName`, `edrpou` (8 або 10 цифр), `clientId?` (UUID) |
| `GET` | `/api/kep/list` | Список КЕП поточного юзера | — |
| `DELETE` | `/api/kep/:id` | Видалити КЕП | — |
| `POST` | `/api/kep/:id/test` | Тест розшифровки (без ДПС) | — |

**POST /api/kep/upload — відповідь (201):**
```json
{ "id": "uuid", "clientName": "...", "edrpou": "...", "fileName": "...", "createdAt": "..." }
```

**GET /api/kep/list — відповідь:**
```json
[{ "id", "clientName", "edrpou", "fileName", "fileSize", "isActive", "lastUsedAt", "createdAt", "updatedAt" }]
```
Blob-поля (`encrypted_kep_blob`, `encrypted_dek` тощо) **ніколи** не повертаються.

**POST /api/kep/:id/test — відповідь:**
```json
{ "success": true, "clientName": "...", "edrpou": "..." }
// або
{ "success": false, "error": "KEP not found or not active" }
```

### 18.3 Rate limiting і обмеження

| Параметр | Значення |
|---|---|
| Upload rate limit | 10 запитів / годину / IP |
| Максимальний розмір файлу | 5 MB |
| File storage | RAM тільки (multer `memoryStorage`) — на диск не пишеться |
| Перевищення розміру | HTTP 413 |

### 18.4 Результати тестування (2026-04-02, production)

Тести виконувались на `https://dps-monitor-production.up.railway.app` з реальними тестовими юзерами (створені через Supabase admin API, видалені після тестів).

| # | Тест | Очікувано | Результат |
|---|---|---|---|
| 1 | GET/POST/DELETE/POST без токена | 401 на всіх | ✅ |
| 2 | Невалідний Bearer токен | 401 | ✅ |
| 3 | Upload без файлу (з валідним токеном) | 400 "Файл КЕП обов'язковий" | ✅ |
| 4 | Upload без поля `password` | 400 | ✅ |
| 5 | Upload з `edrpou` = 7 цифр | 400 "має містити 8 або 10 цифр" | ✅ |
| 6 | Upload коректного файлу | 201 + `{id, edrpou, fileName, createdAt}` | ✅ |
| 7 | GET /list після upload | Масив 1 елемент, без blob-полів | ✅ |
| 8 | POST /:id/test | `{success: true, edrpou: "..."}` | ✅ |
| 9 | DELETE /:id | `{success: true}` | ✅ |
| 10 | DELETE вже видаленого | 404 | ✅ |
| 11 | POST /:id/test після видалення | `{success: false, error: "..."}` | ✅ |
| 12 | Upload файлу > 5 MB | 413 | ✅ (баг: спочатку 500, виправлено `multerSingle()`) |
| 13 | User2 пробує DELETE/test KEP user1 | 404 / `success: false` | ✅ |

**Баг знайдений під час тестування:** multer `LIMIT_FILE_SIZE` error не перехоплювався → 500. Виправлено wrapper-функцією `multerSingle()` яка ловить `MulterError` і маппить `LIMIT_FILE_SIZE` → 413.

---

## 19. Security Audit — KEP Encryption Layer (2026-04-02)

Два незалежних аудити Security Engineer агента по файлах `kepEncryptionService.ts`, `kepCredentials.ts`, `kepRoutes.ts`. Всі знайдені проблеми виправлено в тому ж сеансі (коміт `0109756`).

### 19.1 Виправлені проблеми

#### CRITICAL

**C-1 — kepCredentials.ts: userId без JWT верифікації**
- **Проблема:** userId брався з тіла запиту або `X-User-Id` заголовку без криптографічної перевірки. При компрометації `BACKEND_API_SECRET` зловмисник міг читати/видаляти КЕП будь-якого користувача, підставивши довільний UUID.
- **Виправлення:** Додано `authMiddleware` в `kepCredentials.ts` — аналогічний до `kepRoutes.ts`. Вимагає `Authorization: Bearer <supabase-jwt>`. `userId` береться **виключно** з верифікованого JWT через `supabase.auth.getUser(token)`. Обидва захисти (`X-Backend-Secret` + JWT) обов'язкові одночасно.
- **Вплив на виклики:** `backendUploadKepCredential()` у `web/lib/backend.ts` тепер приймає обов'язковий параметр `accessToken` і пересилає його як `Authorization: Bearer`.
- **⚠️ Важливо для кроку D міграції:** Коли `kep/route.ts` буде перемикатися на `backendUploadKepCredential()`, потрібно отримати JWT через `(await supabase.auth.getSession()).data.session?.access_token` і передати як `accessToken`.

**C-2 — kepRoutes.ts: req.file.buffer не занулювався**
- **Проблема:** Після виклику `encryptKep()` plaintext КЕП залишався в `req.file.buffer` (multer memoryStorage) до збирання сміття.
- **Виправлення:** Збережено посилання `const kepFileBuffer = req.file.buffer` перед `try`, в `finally` — `kepFileBuffer.fill(0)`. Спрацьовує в усіх code paths (успіх, помилка, виняток).

#### HIGH

**H-1/H-2 — kepCredentials.ts: path params без UUID валідації**
- **Проблема:** `clientId` у `/by-client/:clientId` та `kepId` у `/:kepId` (GET/DELETE) передавались у Supabase запити без перевірки формату.
- **Виправлення:** Додано `isValidUuid()` перевірку для всіх path params, повертає `400` при невалідному форматі.

**H-3 — kepRoutes.ts /test: err.message у відповіді**
- **Проблема:** При помилці `decryptKep()` повне повідомлення винятку (може містити Supabase деталі, назви таблиць, `"KEP not found or not active"`) відправлялось у браузер — enumeration oracle.
- **Виправлення:** `res.json({ success: false, error: 'Не вдалось розшифрувати КЕП' })` — фіксований рядок. Реальна помилка логується через `console.error`.

**H-4 — kepRoutes.ts DELETE: regex на err.message**
- **Проблема:** HTTP статус 404 vs 500 визначався через `/not found|not owned/i.test(err.message)` — крихкий контракт на текст внутрішньої помилки.
- **Виправлення:** Введено `KepNotFoundError extends Error` (експортується з `kepEncryptionService.ts`). `deleteKep()` кидає `KepNotFoundError` при відсутньому/чужому KEP. Роут ловить `err instanceof KepNotFoundError` → 404.

**H-5 — kepRoutes.ts multerSingle: сирий err.message**
- **Проблема:** Для `MulterError` (крім `LIMIT_FILE_SIZE`) та непередбачених помилок `err.message` відправлявся клієнту.
- **Виправлення:** Всі multer помилки повертають фіксований рядок `'Помилка обробки файлу'`. Непередбачені помилки логуються через `console.error`.

#### MEDIUM

**M-1 — kepEncryptionService.ts: cleanup() без cleaned флагу**
- **Проблема:** Повторний виклик `cleanup()` мовчки перезанулював вже занулені буфери — потенційне маскування помилок логіки.
- **Виправлення:** Додано `let cleaned = false` в замиканні. Повторний виклик — no-op.

**M-2 — kepEncryptionService.ts: сирий err.message в audit log**
- **Проблема:** `err.message` (може містити AWS ARN, Supabase внутрішні коди) писався в `kep_access_log.error_message` без обробки.
- **Виправлення:** Функція `sanitizeErrorMessage()` — видаляє AWS ARN патерни (`arn:aws:...` → `[ARN]`), обрізає до 500 символів. Використовується у всіх викликах `writeAuditLog` при помилках.

**M-3 — index.ts CORS: X-User-Id відсутній у allowedHeaders**
- **Виправлення:** Додано `'X-User-Id'` до `allowedHeaders`. Актуально для браузерних/мобільних клієнтів у майбутньому.

**M-4 — index.ts: відсутній trust proxy**
- **Проблема:** Railway запускає сервіс за reverse proxy. Без `trust proxy` rate limiter бачив IP проксі, а не реального клієнта.
- **Виправлення:** `app.set('trust proxy', 1)` — додано одразу після ініціалізації Express app.

**M-5 — kepEncryptionService.ts activateKep(): немає pre-check**
- **Проблема:** `activateKep()` відразу викликав RPC без перевірки що `kepId` належить `userId`.
- **Виправлення:** Перед RPC викликом — Supabase query `.eq('id', kepId).eq('user_id', userId)`. Якщо запис не знайдено — `KepNotFoundError`.

#### LOW

**L-2 — kepCredentials.ts POST /upload: kepFileBuffer не занулювався**
- **Проблема:** `Buffer.from(kepData, 'utf8')` у внутрішньому роуті не занулювався після `encryptKep()`.
- **Виправлення:** `finally { kepFileBuffer.fill(0) }` навколо `encryptKep()` + `activateKep()`.

### 19.2 Архітектурні зміни, що залишилися незмінними

Аудит підтвердив коректність:
- DEK zeroing у `encryptKep()` і `decryptKep()` — всі code paths покриті
- `cleanup()` патерн у всіх викликах `decryptKep()`
- `timingSafeEqual` у `auth.ts` для порівняння `BACKEND_API_SECRET`
- `.maybeSingle()` замість `.single()` у `decryptKep()` (виправлено у попередній сесії)
- Атомарна активація КЕП через `activate_kep_atomic` PostgreSQL функцію (міграція 007)

### 19.3 Відкриті LOW-пріоритетні спостереження (без виправлення)

| # | Спостереження | Рішення |
|---|---|---|
| L-1 | `aesGcmDecryptBuffer` blob parser — edge case з `:` у base64 | Прийнятно: недосяжно без компрометації БД; `parts.length !== 3` вже перевіряється |
| L-3 | KMS client singleton не підхоплює ротацію credentials без рестарту | Прийнятно: Railway перезапускає при деплої; задокументувати в runbook ротації ключів |
| L-4 | Stack traces у Railway logs містять шляхи до файлів контейнера | Прийнятно: логи Railway не публічні; обмежити доступ до Railway проєкту |
