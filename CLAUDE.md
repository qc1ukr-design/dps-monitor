# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Цей файл читається автоматично при кожному запуску Claude Code.
> Дотримуватись цих правил ОБОВ'ЯЗКОВО у кожній сесії.

---

## 1. Власник продукту — не програміст

**Користувач — product owner без технічного бекграунду.**

Правила спілкування:
- Пояснювати технічні рішення простою мовою (аналогії, без жаргону)
- Перед тим як писати код — коротко пояснити ЩО будемо робити і ЧОМУ
- Якщо є 2+ варіанти реалізації — показати вибір з pros/cons, рекомендувати один
- Після завершення завдання — підсумувати що змінилося і що тестувати
- Не питати про кожен дрібний крок — працювати самостійно, питати тільки при справжній розвилці

---

## 2. Стек технологій

```
Web (Vercel):    Next.js 16 App Router · TypeScript · Tailwind CSS · Supabase Auth
Backend (Railway): Express.js · Node.js · TypeScript
Database:        Supabase (PostgreSQL) — проект zvvvgjmyecabhugvkyjz
Crypto (КЕП):   jkurwa (ДСТУ 4145, CAdES-BES) — підписання запитів до ДПС
Encryption:      AWS KMS eu-central-1 (CMK alias/dps-monitor-kep) — envelope encryption
Mobile:          React Native / Expo (директорія mobile/ — in development)
Deploy:          git push → Vercel auto-deploy (rootDir: web/) + Railway auto-deploy (watchPatterns: backend/**)
```

---

## 3. Команди розробки

```bash
# Web (з директорії web/)
npm run dev        # next dev — http://localhost:3000
npm run build      # next build
npm run lint       # next lint (ESLint + type-check)

# Backend (з директорії backend/)
npm run dev        # ts-node-dev (watch mode)
npm run build      # tsc → dist/
npm run start      # node dist/index.js
npm run lint       # tsc --noEmit (тільки type-check)

# Root (монорепо)
npm run dev:web    # запустити web dev server
npm run dev:mobile # запустити Expo dev server
npm run build:web  # збудувати web для production

# Mobile (з директорії mobile/)
npm run start      # expo start
```

> Немає окремих unit-тестів. Перевірка — через smoke tests на `/kms/test` та `/health/ready` після деплою.

---

## 4. Структура проєкту

```
DPS-Monitor/
├── web/                          # Next.js (Vercel) — основний застосунок
│   ├── app/
│   │   ├── api/clients/[id]/
│   │   │   ├── route.ts          # GET/DELETE клієнта
│   │   │   ├── sync/route.ts     # POST — синхронізація з ДПС
│   │   │   ├── kep/route.ts      # POST upload / GET info КЕП
│   │   │   ├── token/route.ts    # POST UUID-токен (альтернативний метод)
│   │   │   └── documents/route.ts
│   │   ├── api/clients/from-kep/route.ts   # POST — створення клієнта з КЕП
│   │   ├── api/cron/
│   │   │   ├── sync-all/route.ts           # Cron 04:00 UTC щодня
│   │   │   └── weekly-digest/route.ts      # Cron Пн 08:00 UTC
│   │   ├── api/export/excel/route.ts
│   │   └── dashboard/
│   └── lib/
│       ├── backend.ts            # HTTP-клієнт до Railway backend
│       └── dps/
│           ├── signer.ts         # КЕП-підписання (jkurwa)
│           ├── dps-auth.ts       # OAuth2 авторизація ДПС
│           ├── normalizer.ts     # Нормалізація відповідей ДПС API
│           └── alerts.ts         # Логіка алертів
├── backend/src/                  # Express.js (Railway)
│   ├── lib/
│   │   ├── kmsClient.ts          # AWS KMS: encrypt/decrypt/generateDataKey
│   │   ├── kms.ts                # Envelope encryption (serialize/deserialize)
│   │   └── aes.ts                # Legacy AES decrypt (для старих записів)
│   ├── services/
│   │   └── kepEncryptionService.ts  # НОВА таблиця kep_credentials (per-KEP DEK)
│   ├── routes/
│   │   ├── kep.ts                # POST /kep/upload (legacy, dead), GET /kep/:clientId → kep_credentials only
│   │   ├── kepCredentials.ts     # POST /kep-credentials/upload, GET by-client/:clientId, CRUD (JWT auth)
│   │   └── kms.ts                # GET /kms/test
│   └── middleware/auth.ts        # X-Backend-Secret header validation
├── supabase/migrations/          # SQL міграції (001–006 виконано)
├── mobile/                       # React Native (Expo) — in development
└── docs/
    ├── TECHNICAL.md              # Повна технічна документація
    └── ALERT_POLICY.md           # Політика алертів
```

---

## 5. База даних — таблиці та їх стан

| Таблиця | Призначення | Стан |
|---|---|---|
| `clients` | Клієнти (id, name, edrpou, user_id) | ✅ Production |
| `api_tokens` | КЕП legacy storage (kep_encrypted KMS envelope, kep_password_encrypted) | ✅ Production, всі записи на KMS |
| `dps_cache` | Кеш ДПС (profile, budget, documents, archive_flag) | ✅ Production |
| `alerts` | Алерти (debt_change, kep_expiring, sync_stale тощо) | ✅ Production |
| `user_settings` | telegram_chat_id, notify_telegram | ✅ Production |
| `kep_credentials` | КЕП (per-KEP DEK, client_id NOT NULL, is_active, ca_name, owner_name, org_name, tax_id, valid_to — міграції 005–008) | ✅ Production, 6/6 клієнтів мігровано |
| `kep_access_log` | Аудит операцій з КЕП | ✅ Production (RLS: INSERT=authenticated, SELECT=service_role only) |

**Наступна міграція — 009** (при потребі).

---

## 6. Безпека — критичні правила (НІКОЛИ не порушувати)

1. **Секрети** — ніколи не комітити `.env`, `.env.local`, будь-які файли з реальними ключами
2. **КЕП plaintext** — ніколи не зберігати розшифрований КЕП або пароль у БД, логах, console.log
3. **DEK** — після використання завжди `buffer.fill(0)` у всіх code paths (success + catch)
4. **Шифрування** — тільки через AWS KMS envelope encryption; legacy AES (`aes.ts`) — тільки читання старих записів, не писати нові
5. **Auth між сервісами** — `X-Backend-Secret` header обов'язковий для всіх backend endpoints
6. **RLS Supabase** — кожна нова таблиця повинна мати RLS policies; `kep_access_log` — INSERT для authenticated, SELECT заблоковано
7. **SQL ін'єкції** — використовувати parameterized queries або Supabase `.eq()` методи
8. **CORS** — backend дозволяє тільки Vercel origin
9. **cleanup()** — при `decryptKep()` завжди викликати `kep.cleanup()` у блоці `finally`

---

## 7. Routing агентів — хто що робить

### Архітектурне питання перед кодом
→ **`Plan`** або **`Backend Architect`**
- Будь-яке питання "як краще зробити X" перед написанням коду
- Вибір між варіантами реалізації
- Зміни схеми БД, нові таблиці, зміни API

### Написання backend коду (Express, services, KMS, Supabase)
→ **`Backend Architect`** або **`Senior Developer`**
- `backend/src/**` — routes, services, middleware, lib
- SQL міграції (`supabase/migrations/`)
- Нові Express endpoints

### Написання frontend коду (Next.js, React, Tailwind)
→ **`Frontend Developer`** або **`Senior Developer`**
- `web/app/**` — сторінки, API routes, компоненти
- `web/lib/**` — клієнтські утиліти
- Dashboard UI, нові сторінки

### Безпека — аудит, вразливості, перевірка коду
→ **`Security Engineer`**
- Перевірка нового коду на вразливості
- Аудит обробки КЕП-даних
- Перевірка RLS policies
- Будь-яке питання "чи безпечно це?"
- OWASP Top 10, injection, XSS, secrets exposure

### Code review перед комітом
→ **`Code Reviewer`**
- Перевірка якості, читабельності, правильності
- Виявлення логічних помилок
- Пропозиції по рефакторингу (тільки якщо критично)

### Тестування
→ **`API Tester`** (для API endpoints)
→ **`Evidence Collector`** (для UI/функціональних перевірок)
→ **`Reality Checker`** (для перевірки production readiness)
- Перевірка нових ендпоінтів
- Smoke tests після деплою
- Перевірка KMS connectivity (`/kms/test`)

### Мобільний застосунок (`mobile/`)
→ **`Mobile App Builder`**
- React Native / Expo розробка
- iOS/Android специфіка

### Продуктові рішення — що будувати, пріоритети
→ **`Product Manager`** або **`Sprint Prioritizer`**
- "Що робити далі?"
- Пріоритизація features
- Розбивка великих задач

### Документація
→ **`Technical Writer`**
- Оновлення `docs/TECHNICAL.md`
- API документація
- README

### DevOps — деплой, Railway, Vercel, CI/CD
→ **`DevOps Automator`**
- Налаштування auto-deploy
- Змінні середовища
- Cron jobs

---

## 8. Workflow — стандартний процес змін

### Для будь-якої нової features:
1. **Читаємо код** — завжди читати існуючі файли перед зміною
2. **Архітектура** — якщо зміна нетривіальна → Plan agent або коротке обговорення
3. **Security check** — будь-яка зміна що торкається КЕП, шифрування, auth → Security Engineer
4. **Пишемо код** — мінімальні зміни, тільки те що потрібно
5. **Code review** — Code Reviewer agent для нетривіальних змін
6. **Тест** → перевірити що не зламали існуюче
7. **Документація** — оновити `docs/TECHNICAL.md` якщо змінилась архітектура

### Для SQL міграцій:
- Файл: `supabase/migrations/00N_description.sql`
- Наступна: `011_...sql`
- Завжди включати: RLS policies, індекси, тригери updated_at якщо є
- Виконувати через Supabase SQL Editor (не через CLI якщо не налаштовано)

### Для нових backend routes:
- Реєструвати у `backend/src/routes/index.ts`
- Захищати через `requireApiSecret` middleware
- Додавати відповідну функцію у `web/lib/backend.ts`

---

## 9. Продакшн середовище

| Сервіс | URL | Auto-deploy |
|---|---|---|
| Web | `https://dps-monitor.vercel.app` | git push → main (rootDir: web/) |
| Backend | `https://dps-monitor-production.up.railway.app` | git push → main (watchPatterns: backend/**) |
| Supabase | `https://zvvvgjmyecabhugvkyjz.supabase.co` | Ручні міграції |

**Vercel проект:** `dps-monitor` (репо `qc1ukr-design/dps-monitor`, гілка `main`)
> `web-gold-rho-91.vercel.app` — СТАРИЙ ізольований деплой, не підключений до git. Ігнорувати.

---

## 10. Змінні середовища — де що живе

### Web (Vercel):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (sb_publishable_...),
`SUPABASE_SERVICE_ROLE_KEY` (sb_secret_...), `BACKEND_URL`, `BACKEND_API_SECRET`,
`TELEGRAM_BOT_TOKEN`, `CRON_SECRET`, `EMAIL_FROM`, `RESEND_API_KEY`

### Backend (Railway):
`BACKEND_API_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (eu-central-1),
`AWS_KMS_KEY_ID` (arn:aws:kms:eu-central-1:826496717510:key/17fd8a9a-...)

---

## 11. Критичні технічні деталі (часті помилки)

### КЕП і ЄДРПОУ vs РНОКПП
- `clients.edrpou` для ЮО = ЄДРПОУ (8 цифр) з `organizationIdentifier` сертифікату
- `clients.edrpou` для ФО/ФОП = РНОКПП (10 цифр) з `serialNumber` сертифікату
- `api_tokens.kep_tax_id` = ЗАВЖДИ РНОКПП (для OAuth підписання)
- Визначення ЮО: `/^\d{8}$/.test(edrpou)` → true = ЮО
- **НЕ плутати** `orgTaxId` (ЄДРПОУ) з `taxId` (РНОКПП) у `signer.ts`

### OAuth ДПС для ЮО
- ЮО OAuth методи (`loginWithKepAsYuo` тощо) → "Ви не маєте права підпису" якщо директор не в реєстрі
- Робочий обхід: `loginWithKep` (ФО OAuth) → `ws/api/regdoc/list` → повертає ЮО звіти через `organizationIdentifier`
- `reg_doc/list` (public_api) ідентифікує за `serialNumber` (РНОКПП) — повертає особисті дані директора!
- `regdoc/list` (ws/api OAuth) ідентифікує за `organizationIdentifier` — правильно для ЮО ✅

### kep_credentials lookup (майбутній route)
- Завжди `WHERE client_id = $1 AND is_active = true LIMIT 1` — не `single()`
- При завантаженні нового КЕП → деактивувати старий (`is_active = false`), не видаляти
- `cleanup()` обов'язково у `finally` блоці

### Шифрування
- Auto-detect формату: `isKmsEnvelope(stored)` → base64 JSON з version:1 → KMS, інакше → legacy AES hex
- Новий код завжди пише KMS envelope через `kepEncryptionService.ts`
- Legacy AES (`aes.ts`) — тільки читання, не писати

---

## 12. Поточні відкриті задачі (станом на 2026-04-04, сесія 11)

Всі технічні борги закрито. Мобільний MVP завершено і протестовано.

- [x] **Міграції 005–010** — завершено ✅
- [x] **Mobile Спринти 1–3** — завершено, протестовано на iPhone ✅ (2026-04-04)
- [x] **Mobile Bearer auth** — `proxy.ts`, `mobile.ts`, 3 нові API routes ✅ (2026-04-04)
- [x] **kep_credentials.tax_id backfill** — 6/6 клієнтів ✅ (2026-04-04)
- [x] **Budget data fix** — `calculations` сумуються, `formatMoney` виправлено ✅ (2026-04-04)
- [x] **kepValidTo + lastSyncAt** — `GET /api/clients/[id]` повертає ✅ (2026-04-04)
- [x] **Mobile Спринт 4 — Push Notifications** — завершено ✅ (2026-04-05)

**Наступна міграція — 012** (при потребі).

**Наступні кроки (з чого починати наступну сесію):**

1. **Тестування (до Apple Developer акаунту):**
   - Android APK через EAS Build (безкоштовно, без акаунту розробника):
     `npx eas-cli build --profile preview --platform android`
   - Встановити APK через QR-код → тестувати push notifications на Android
   - iOS без push: Expo Go + QR-код (команда `npx expo start`)

2. **Apple Developer акаунт ($99/рік):**
   - Після придбання: `npx eas-cli build --profile development --platform ios`
   - Потрібен для TestFlight, push на iPhone, App Store

3. **Нові типи клієнтів** — ФОП-загальна система, ЮО (ALERT_POLICY.md §3.2–3.4)

4. **Верифікація cron** — перевірити Vercel logs о 04:00 UTC: всі 6 клієнтів мають `ok: true`

**EAS конфігурація (станом на 2026-04-05):**
- `bundleIdentifier`: `com.margoqc.dpsmonitor`
- `projectId`: `54d0cb67-2510-4545-bea5-0bb0ab9af190` (@margoqc/mobile на expo.dev)
- `eas.json` створено (профілі: development, preview, production)
- Apple Developer акаунт: не придбано (потрібен для iOS build і push на iPhone)

Повна документація: `docs/TECHNICAL.md` §20 (розділи 20.10 і 20.11).

---

## 13. Заборонено

- Комітити будь-які `.env*` файли
- Писати `console.log` з КЕП, паролем, DEK або токенами
- Зберігати plaintext КЕП в БД (навіть тимчасово)
- Використовувати `single()` для `kep_credentials` lookup (кине помилку при >1 записі)
- Ігнорувати `cleanup()` після `decryptKep()`
- Писати нові дані через legacy AES encrypt (тільки KMS)
- Робити `git push --force` без підтвердження
- Видаляти колонку `kep_password_encrypted` з `api_tokens` без окремого рефакторингу
