# DPS-Monitor — Технічна документація

> Останнє оновлення: 2026-04-01 (сесія 4)

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
│       ├── routes/
│       │   ├── kep.ts            # POST /kep/upload, GET /kep/:clientId
│       │   └── kms.ts            # GET /kms/test (перевірка KMS connectivity)
│       └── middleware/
│           └── auth.ts           # requireApiSecret (X-Backend-Secret header)
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
| `api_tokens` | КЕП та UUID-токени, зашифровані AES |
| `dps_cache` | Кеш відповідей ДПС (profile, budget, documents, archive_flag) |
| `alerts` | Алерти про зміни (борг, статус, нові документи, КЕП, stale sync) |
| `user_settings` | Налаштування користувача (telegram_chat_id, notify_telegram) |

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

Функція `isKmsEnvelope(stored: string): boolean` у `backend/src/routes/kep.ts`:
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

| Метод | Шлях | Опис |
|---|---|---|
| `POST` | `/kep/upload` | Приймає `{ clientId, userId, kepData, password, kepInfo }`. KMS-шифрує, upsert у `api_tokens` |
| `GET` | `/kep/:clientId?userId=` | Читає з БД, auto-detect формат, розшифровує, повертає `{ kepData, password }` |
| `GET` | `/kms/test` | Перевіряє KMS connectivity: `generateDataKey` + `encrypt` + `decrypt`. Захищений `X-Backend-Secret` |

### 11.6 `web/lib/backend.ts`

```typescript
export async function backendGetKep(clientId: string, userId: string): Promise<{ kepData: string; password: string }>
```

Використовується у:
- `web/app/api/clients/[id]/sync/route.ts`
- `web/app/api/cron/sync-all/route.ts`

Timeout: 10 секунд. Кидає `Error` при non-2xx або timeout.

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

---

## 17. Поточний стан системи (станом на 2026-04-01, кінець сесії 4)

### ✅ Повністю завершено і стабільно

| Область | Стан |
|---|---|
| **Шифрування КЕП** | 100% KMS envelope encryption. Всі 6 записів у БД мігровано. Legacy AES більше не використовується для нових записів. |
| **Backend (Railway)** | Express.js сервіс запущений. KMS connectivity підтверджено (`/kms/test`). Авто-деплой при push у `backend/**`. |
| **Синхронізація (cron)** | `sync-all` щодня о 04:00 UTC. Остання перевірка: 6/6 клієнтів OK, 0 помилок. |
| **Алерти** | Борг, статус, нові документи, КЕП expiry (30 днів), stale sync (48 год) — всі типи реалізовані та задеплоєні. |
| **Telegram-нотифікації** | Бот `8716647020` активний. Щоденні алерти + тижневий дайджест (пн 08:00 UTC). |
| **Dashboard** | Таблиця з фільтрами/сортуванням/архівом. Колонка "КЕП до" з кольоровим індикатором. |
| **Excel-експорт** | 8 колонок у зведеному звіті, включаючи "КЕП дійсний до" з кольором. |
| **Безпека секретів** | Всі секрети ротовано після виявлення витоку. `.gitignore` захищає від повторення. Supabase мігровано на новий формат ключів (`sb_publishable_` / `sb_secret_`). |

### 🌐 Продакшн URL

| Сервіс | URL | Статус |
|---|---|---|
| Web (Vercel) | `https://web-gold-rho-91.vercel.app` | ✅ Online |
| Backend (Railway) | `https://dps-monitor-production.up.railway.app` | ✅ Online |
| Supabase | `https://zvvvgjmyecabhugvkyjz.supabase.co` | ✅ Active |

> **Примітка:** `dps-monitor.vercel.app` — аліас, який вказує на виробничий деплой. Основний прямий URL — `web-gold-rho-91.vercel.app`. Обидва функціонально ідентичні.

### 🔑 Поточні ключі (формат, не значення)

| Ключ | Формат | Де зберігається |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_...` (новий Supabase формат) | Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_...` (новий Supabase формат) | Vercel + Railway |
| `TELEGRAM_BOT_TOKEN` | `8716647020:AAE...` (ротовано 2026-04-01) | Vercel |
| `CRON_SECRET` | 64 hex символи (ротовано 2026-04-01) | Vercel + Railway |
| `TOKEN_ENCRYPTION_KEY` | 64 hex символи (ротовано 2026-04-01) | Vercel + Railway |
| `AWS_KMS_KEY_ID` | `arn:aws:kms:eu-central-1:826496717510:key/17fd8a9a-...` | Railway |

### 💡 Можливі наступні кроки (не обов'язкові)

- **`kep_password_encrypted`** — колонка активно використовується backend (читання + запис); _не видаляти_. Якщо потрібно — окремий рефакторинг: об'єднати в один envelope з `kep_encrypted`.
- **npm вразливості** — 3 з 7 виправлено (`npm audit fix`). Решта 4 потребують Next.js 14→16 (breaking); відкладено.
- **Нові функції** — за потребою замовника
