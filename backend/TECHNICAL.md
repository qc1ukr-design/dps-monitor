# DPS-Monitor Backend — Технічна документація

> Останнє оновлення: 2026-04-01

---

## 1. Призначення сервісу

**`/backend`** — окремий Node.js/Express сервіс, задеплоєний на Railway. Він є довіреним сервером між фронтендом (`/web`, Vercel) і криптографічною інфраструктурою (AWS KMS).

### Чим відрізняється від /web

| Аспект | `/web` (Vercel, Next.js) | `/backend` (Railway, Express) |
|---|---|---|
| Середовище | Serverless функції, cold start | Persistent Node.js процес, завжди живий |
| Шифрування КЕП | AES-256-GCM, ключ у env (`TOKEN_ENCRYPTION_KEY`) | Envelope Encryption: AWS KMS + AES-256-GCM |
| Доступ до AWS KMS | Немає | Так — єдина точка звернення до KMS |
| Supabase доступ | Service role + RLS (залежно від контексту) | Service role, обходить RLS |
| Відповідальність | UI, cron-синхронізація, алерти, звітність | Безпечна робота з КЕП: шифрування, дешифрування, підписання |
| Авторизація вхідних запитів | Supabase JWT сесія користувача | Shared secret (`X-Backend-Secret` header) |
| Публічний доступ | Так (через браузер) | Ні — тільки для `/web` і внутрішніх сервісів |

### Основне завдання

`/backend` вирішує одну критичну проблему: **КЕП (приватний ключ платника) не повинен бути доступний у Vercel-середовищі** в розшифрованому вигляді довше ніж необхідно для одного підписання. AWS KMS дозволяє зробити так, що plaintext data key ніколи не зберігається — він існує тільки в RAM на час операції.

---

## 2. Архітектура системи

```
Браузер користувача
       │  HTTPS (Supabase JWT)
       ▼
┌─────────────────────────────┐
│   /web  —  Vercel           │
│   Next.js 14, App Router    │
│   cron: sync-all (щодня)    │
│   cron: weekly-digest (пн)  │
└──────────┬──────────────────┘
           │  HTTP POST  X-Backend-Secret
           │  (server-to-server, не від браузера)
           ▼
┌─────────────────────────────┐
│   /backend  —  Railway      │
│   Node.js, Express          │
│   Єдина точка KMS-операцій  │
└──────┬───────────┬──────────┘
       │           │
       │           │  AWS SDK
       │           ▼
       │    ┌─────────────────┐
       │    │   AWS KMS       │
       │    │  (eu-central-1) │
       │    │  CMK (master)   │
       │    └─────────────────┘
       │
       │  @supabase/supabase-js (service role)
       ▼
┌─────────────────────────────┐
│   Supabase (PostgreSQL)     │
│   Спільна БД для /web       │
│   і /backend                │
└─────────────────────────────┘
       │
       │  fetch() — HTTPS
       ▼
┌─────────────────────────────┐
│   API ДПС                   │
│   cabinet.tax.gov.ua        │
│   ws/public_api             │
│   ws/auth/oauth/token       │
│   ws/api                    │
└─────────────────────────────┘
```

### Потік даних при завантаженні нового КЕП

```
Браузер → POST /web/api/clients/from-kep (pfx файл)
  → /web зчитує сертифікат (jkurwa), отримує taxId, orgTaxId, ownerName...
  → /web надсилає POST /backend/kep/encrypt { kepBase64, password, clientId }
    → /backend: KMS.GenerateDataKey → plaintext DEK
    → /backend: AES-GCM(kepBase64, DEK) → ciphertext
    → /backend: AES-GCM(password, DEK) → ciphertext
    → /backend: відкидає plaintext DEK
    → /backend: зберігає KmsEnvelope в Supabase api_tokens
  → /web отримує { ok: true }, зберігає метадані (ім'я, АЦСК, термін дії)
```

### Потік даних при синхронізації (підписання)

```
/web cron або dashboard → POST /backend/kep/sign { clientId, taxId }
  → /backend: читає KmsEnvelope з Supabase
  → /backend: KMS.Decrypt(encryptedDataKey) → plaintext DEK
  → /backend: AES-GCM.decrypt(kepCiphertext, DEK) → kepPlaintext
  → /backend: AES-GCM.decrypt(pwdCiphertext, DEK) → password
  → /backend: DEK.fill(0) — обнуляємо в RAM
  → /backend: jkurwa.sign(taxId, kep, pwd) → CAdES-BES base64
  → /backend: повертає { signature } (КЕП в plaintext НЕ виходить за межі /backend)
  → /web: Authorization: <signature> → cabinet.tax.gov.ua
```

---

## 3. Структура папок

```
backend/
├── src/
│   ├── index.ts              # Express app: ініціалізація, middleware, запуск
│   ├── types/
│   │   └── index.ts          # TypeScript типи: DPS, DB rows, KmsEnvelope, KepInfo
│   ├── lib/
│   │   ├── supabase.ts       # Singleton Supabase service-role клієнт
│   │   ├── kms.ts            # Envelope encryption/decryption через AWS KMS
│   │   └── aes.ts            # Читання існуючих AES-256-GCM значень з /web
│   ├── middleware/
│   │   ├── auth.ts           # X-Backend-Secret header validation
│   │   └── errorHandler.ts   # Глобальний Express error handler
│   ├── routes/
│   │   ├── index.ts          # Агрегатор роутів
│   │   └── health.ts         # GET /health — Railway healthcheck
│   └── services/             # Бізнес-логіка (KEP, синхронізація — майбутні файли)
├── package.json
├── tsconfig.json             # TypeScript strict mode, target ES2022
├── railway.toml              # Railway build + deploy + healthcheck конфіг
├── .env.example              # Шаблон змінних середовища
└── TECHNICAL.md              # Цей файл
```

### Що де живе

| Папка/файл | Відповідальність |
|---|---|
| `src/index.ts` | Express bootstrap: helmet, cors, rate-limit, routes, error handler |
| `src/lib/supabase.ts` | Один клієнт на весь процес, ініціалізується при першому виклику |
| `src/lib/kms.ts` | `kmsEncrypt`, `kmsDecrypt`, `serializeEnvelope`, `deserializeEnvelope` |
| `src/lib/aes.ts` | `aesDecrypt` — зворотньо сумісний з `/web/lib/crypto.ts` (той самий salt) |
| `src/middleware/auth.ts` | Перевіряє `X-Backend-Secret` header на кожному захищеному роуті |
| `src/middleware/errorHandler.ts` | Ловить всі непойманні помилки, відповідає JSON |
| `src/routes/health.ts` | `GET /health` — перевіряє з'єднання з Supabase, повертає `{ status: "ok" }` |
| `src/services/` | Сюди додаємо KEP-сервіс, DPS-підписання, міграцію — по одному файлу на домен |

---

## 4. API ендпоінти

### Поточні (реалізовані)

| Метод | Шлях | Auth | Опис |
|---|---|---|---|
| `GET` | `/health` | — | Liveness/readiness check для Railway |

### Заплановані

| Метод | Шлях | Auth | Опис |
|---|---|---|---|
| `POST` | `/kep/encrypt` | Secret | Зашифрувати КЕП через KMS, зберегти в Supabase |
| `POST` | `/kep/sign` | Secret | Підписати рядок КЕП (повертає CAdES-BES base64) |
| `POST` | `/kep/migrate` | Secret | Перенести існуючий AES-only КЕП на KMS envelope |
| `GET` | `/kep/info/:clientId` | Secret | Повернути метадані КЕП (без plaintext) |
| `POST` | `/sync/:clientId` | Secret | Синхронізувати клієнта з ДПС (підпис + fetch + кеш) |

> **Важливо:** жоден ендпоінт не повертає plaintext КЕП або пароль. `/kep/sign` повертає тільки результат підписання.

### Авторизація запитів

Всі захищені ендпоінти вимагають заголовок:

```
X-Backend-Secret: <BACKEND_API_SECRET>
```

Значення збігається в `BACKEND_API_SECRET` на Railway і у відповідній env змінній на Vercel.

---

## 5. Схема шифрування КЕП (Envelope Encryption)

### Термінологія

| Термін | Пояснення |
|---|---|
| **CMK** (Customer Master Key) | Майстер-ключ в AWS KMS. Ніколи не залишає KMS. Використовується тільки для шифрування/дешифрування DEK |
| **DEK** (Data Encryption Key) | 256-бітний ключ, який KMS генерує на кожне шифрування. Plaintext DEK існує тільки в RAM під час операції |
| **Envelope** | JSON структура `KmsEnvelope` — зберігає encrypted DEK + AES-GCM ciphertext |

### Шифрування (запис)

```
1. KMS.GenerateDataKey(CMK) → { plaintextDEK, encryptedDEK }
2. AES-256-GCM(kepBase64, plaintextDEK, randomIV) → { ciphertext, tag }
3. AES-256-GCM(password,  plaintextDEK, randomIV) → { ciphertext, tag }
4. plaintextDEK.fill(0)  ← обнулення в пам'яті
5. Зберегти в Supabase api_tokens:
     kep_encrypted = base64(JSON(KmsEnvelope{ encryptedDEK, iv, tag, ciphertext }))
     kep_password_encrypted = base64(JSON(KmsEnvelope{ ... }))
```

### Дешифрування (читання)

```
1. Прочитати KmsEnvelope з Supabase
2. KMS.Decrypt(encryptedDEK, CMK) → plaintextDEK
3. AES-256-GCM.decrypt(ciphertext, plaintextDEK, iv, tag) → kepBase64
4. plaintextDEK.fill(0)
5. Використати kepBase64 + password для підписання (jkurwa)
6. Відкинути kepBase64 і password з RAM
```

### Структура KmsEnvelope (зберігається в Supabase)

```typescript
interface KmsEnvelope {
  version: 1
  kmsKeyId: string         // ARN ключа KMS
  encryptedDataKey: string // base64 — DEK, зашифрований CMK
  iv: string               // base64 — AES-GCM IV (12 bytes)
  tag: string              // base64 — AES-GCM auth tag (16 bytes)
  ciphertext: string       // base64 — зашифрований payload
}
```

### Зворотня сумісність з /web AES шифруванням

Існуючі значення в БД (зашифровані `/web/lib/crypto.ts`) мають формат:
```
<ivHex>:<tagHex>:<ciphertextHex>
```

`/backend/src/lib/aes.ts` вміє їх читати (той самий `scryptSync` + сіль `dps-monitor-salt`). Це дозволяє **поступову міграцію** — старі записи читаються через AES, нові зберігаються через KMS Envelope.

---

## 6. Змінні середовища

| Змінна | Обов'язкова | Опис |
|---|---|---|
| `PORT` | Ні | Порт сервера. За замовчуванням `3001`. Railway встановлює автоматично |
| `SUPABASE_URL` | Так | URL Supabase проєкту (`https://<project>.supabase.co`). Та сама БД що у `/web` |
| `SUPABASE_SERVICE_ROLE_KEY` | Так | Service role ключ — обходить RLS. **Тільки для backend, ніколи в браузер** |
| `TOKEN_ENCRYPTION_KEY` | Так | Той самий секрет що у `/web`. Потрібний для читання старих AES-зашифрованих значень |
| `AWS_REGION` | Так | Регіон AWS де розміщений KMS ключ. Наприклад: `eu-central-1` |
| `AWS_ACCESS_KEY_ID` | Так | IAM Access Key для програмного доступу до KMS |
| `AWS_SECRET_ACCESS_KEY` | Так | IAM Secret Key |
| `AWS_KMS_KEY_ID` | Так | ARN або alias CMK ключа. Наприклад: `arn:aws:kms:eu-central-1:123:key/uuid` |
| `BACKEND_API_SECRET` | Так | Shared secret між `/web` і `/backend`. Мінімум 32 випадкових символи |
| `ALLOWED_ORIGINS` | Ні | Comma-separated список дозволених CORS origins. За замовчуванням `http://localhost:3000` |
| `NODE_ENV` | Ні | `production` / `development`. Впливає на деталізацію помилок у відповідях |

### Мінімальний IAM policy для AWS KMS

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "kms:GenerateDataKey",
        "kms:Decrypt"
      ],
      "Resource": "arn:aws:kms:eu-central-1:ACCOUNT_ID:key/KEY_ID"
    }
  ]
}
```

---

## 7. Запуск локально

### Передумови

- Node.js 20+
- npm 10+
- Доступ до Supabase проєкту (URL + service role key)
- AWS IAM ключі з правом `kms:GenerateDataKey` і `kms:Decrypt` (або заглушка для розробки)

### Кроки

```bash
# 1. Перейти в папку backend
cd backend

# 2. Встановити залежності
npm install

# 3. Створити .env файл з реальними значеннями
cp .env.example .env
# відредагувати .env — заповнити всі обов'язкові змінні

# 4. Запустити в dev-режимі (ts-node-dev, hot reload)
npm run dev

# Сервер слухає: http://localhost:3001
# Healthcheck:   http://localhost:3001/health
```

### Перевірка

```bash
# Liveness check
curl http://localhost:3001/health

# Очікувана відповідь:
# { "status": "ok", "supabase": "ok", "timestamp": "2026-04-01T..." }
```

### Збірка TypeScript

```bash
npm run build
# → компілює src/ → dist/

npm run start
# → запускає dist/index.js
```

---

## 8. Деплой на Railway

### Перший деплой

1. Зайти на [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
2. Обрати репозиторій `dps-monitor`, вибрати папку `/backend` як **Root Directory**
3. Railway автоматично виявить `railway.toml` і використає команди:
   - Build: `npm install && npm run build`
   - Start: `npm run start`

### Змінні середовища на Railway

У Railway dashboard → проєкт → **Variables** додати всі змінні з розділу 6:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
TOKEN_ENCRYPTION_KEY=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_KMS_KEY_ID=
BACKEND_API_SECRET=
ALLOWED_ORIGINS=https://dps-monitor.vercel.app
NODE_ENV=production
```

> `PORT` — Railway встановлює автоматично, не вказувати вручну.

### Домен

Railway видає домен вигляду `dps-monitor-backend.up.railway.app`. Його записати у Vercel як:
```
BACKEND_URL=https://dps-monitor-backend.up.railway.app
```

### Healthcheck

Railway автоматично перевіряє `GET /health` кожні N секунд (налаштовано в `railway.toml`). Якщо повертає не 2xx — Railway перезапускає сервіс.

### Оновлення

```bash
# Кожен push до main гілки — автоматичний redeploy якщо налаштований GitHub trigger
git push origin main
```

---

## 9. Зв'язок з /web

### Як /web викликає /backend

Всі виклики — **server-to-server** з Next.js API routes або cron handlers. Браузер ніколи не звертається до `/backend` напряму.

```typescript
// Приклад виклику з /web/app/api/clients/[id]/sync/route.ts (майбутній)
const res = await fetch(`${process.env.BACKEND_URL}/kep/sign`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Backend-Secret': process.env.BACKEND_API_SECRET!,
  },
  body: JSON.stringify({ clientId, taxId }),
})
```

### Передача авторизації між сервісами

```
Браузер → /web (перевіряє Supabase JWT)
  → якщо авторизований, /web формує server-to-server запит на /backend
  → /backend перевіряє X-Backend-Secret
  → /backend сам читає дані з Supabase за clientId
  → /backend не отримує і не перевіряє JWT користувача
```

Суть: **авторизація користувача** — відповідальність `/web`. **Авторизація сервісу** — `X-Backend-Secret`.

### Env змінні які потрібні на Vercel для зв'язку

| Змінна на Vercel | Опис |
|---|---|
| `BACKEND_URL` | URL Railway сервісу (`https://....up.railway.app`) |
| `BACKEND_API_SECRET` | Той самий секрет що і на Railway |

---

## 10. Що НЕ робить цей сервіс

Чітка межа відповідальності — щоб не виникало спокуси додати зайве:

| Що | Де це робиться |
|---|---|
| Рендеринг UI, SSR сторінок | `/web` (Next.js, Vercel) |
| Авторизація користувачів (email/password, сесії) | Supabase Auth, `/web` middleware |
| Cron-синхронізація всіх клієнтів (щоденний запуск) | `/web/app/api/cron/sync-all` (Vercel Cron) |
| Weekly digest (Telegram/email сповіщення) | `/web/app/api/cron/weekly-digest` |
| Генерація алертів (`detectAlerts`) | `/web/lib/dps/alerts.ts` |
| Excel-експорт | `/web/app/api/export` |
| Читання профілю і бюджету з кешу для дашборду | `/web` API routes |
| Зберігання UUID Bearer-токенів (ws/a рівень) | `/web` — токен вводить користувач вручну |
| Нотифікації (Telegram, email) | `/web/lib/telegram.ts`, `/web/lib/email.ts` |
| Мобільний додаток | `/mobile` |
| Міграції схеми БД | `/supabase/migrations/` |

**`/backend` робить рівно одне:** безпечні криптографічні операції з КЕП (шифрування, дешифрування, підписання) з використанням AWS KMS як root of trust.
