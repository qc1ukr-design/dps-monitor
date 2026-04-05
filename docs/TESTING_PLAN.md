# DPS-Monitor — План тестування

> Версія: 1.0 | Дата: 2026-04-05 | Статус: актуальний

---

## 1. Як тестувати без Apple Developer акаунту

### 1.1 Expo Go (iOS + Android) — вже доступно ЗАРАЗ

- **Що тестується:** весь функціонал КРІМ push notifications
- **Як запустити:** `cd mobile && npx expo start` → сканувати QR-код телефоном
- **Обмеження:** push не працюють в Expo Go (обмеження платформи)
- **Потрібно:** застосунок Expo Go на телефоні (безкоштовно в App Store / Google Play)

### 1.2 Android APK через EAS (без акаунту розробника) — РЕКОМЕНДОВАНО для push тестування

- **Що тестується:** ВЕСЬ функціонал включно з push notifications
- **Як запустити:**

  ```bash
  cd mobile
  npx eas-cli build --profile preview --platform android
  ```

- EAS надає QR-код і пряме посилання для завантаження APK
- Встановити на Android телефон → push notifications працюють повністю
- **Потрібно:** Android телефон (будь-який) або попросити когось з Android

  **EAS конфігурація (станом на 2026-04-05):**
  - `bundleIdentifier`: `com.margoqc.dpsmonitor`
  - `projectId`: `54d0cb67-2510-4545-bea5-0bb0ab9af190` (@margoqc/mobile на expo.dev)
  - `eas.json` створено (профілі: development, preview, production)

### 1.3 iOS через TestFlight (потрібен Apple Developer $99/рік)

- **Що тестується:** ВЕСЬ функціонал на iPhone включно з push
- **Команда:** `npx eas-cli build --profile development --platform ios`
- **Статус:** ЗАБЛОКОВАНО — Apple Developer акаунт не придбано

---

## 2. Рівні тестування і агенти

| Рівень | Що тестується | Агент | Пріоритет |
|---|---|---|---|
| Backend API | Railway endpoints, KMS, KEP decrypt | `API Tester` | Критично |
| Web Dashboard | Vercel UI, авторизація, синхронізація | `Evidence Collector` | Критично |
| Mobile (Expo Go) | Логін, клієнти, алерти, документи | `Mobile App Builder` | Важливо |
| Push Notifications | Android APK, реєстрація token, отримання push | `Mobile App Builder` | Важливо |
| Cron Jobs | sync-all Vercel logs о 04:00 UTC | `API Tester` | Критично |
| Security | Auth, RLS, KMS, token validation | `Security Engineer` | Критично |
| Production Readiness | Всі системи OK перед реальними юзерами | `Reality Checker` | Важливо |

---

## 3. Чеклист тестування по рівнях

### 3.1 Backend API (агент: API Tester)

Endpoint-и для перевірки:

- [ ] `GET /health/ready` → 200 OK
- [ ] `GET /kms/test` → `{ ok: true }` (KMS connectivity)
- [ ] `GET /kep/:clientId` без `X-Backend-Secret` → 401
- [ ] `GET /kep/:clientId` з правильним secret → повертає kepData
- [ ] `POST /api/kep/upload` без Bearer → 401
- [ ] `POST /api/user/push-token` без Bearer → 401
- [ ] `POST /api/user/push-token` з невалідним token → 400
- [ ] `POST /api/user/push-token` з валідним token → 200 `{ ok: true }`

**Додатково — Public KEP REST API (`/api/kep/*`):**

- [ ] `GET /api/kep/list` без токена → 401
- [ ] `POST /api/kep/upload` без файлу (з валідним токеном) → 400
- [ ] `POST /api/kep/:id/test` → `{ success: true }` для активного КЕП
- [ ] `DELETE /api/kep/:id` → 200 і запис деактивовано

### 3.2 Web Dashboard (агент: Evidence Collector)

- [ ] Логін/реєстрація працює
- [ ] Dashboard завантажує список клієнтів
- [ ] Картка клієнта показує бюджет, профіль, КЕП статус
- [ ] Вхідні документи відображаються
- [ ] KEP Upload (drag & drop) працює
- [ ] Excel-експорт завантажується (8 колонок, включаючи "КЕП дійсний до")
- [ ] Telegram налаштування зберігаються
- [ ] Архів клієнтів працює
- [ ] Колонка "КЕП до" показує правильний кольоровий індикатор

### 3.3 Mobile — Expo Go (агент: Mobile App Builder)

Запуск: `npx expo start` → QR-код

- [ ] Логін з email/password
- [ ] Dashboard відображає клієнтів і суми
- [ ] Pull-to-refresh оновлює дані
- [ ] Список клієнтів → клік → деталі
- [ ] Деталі клієнта: бюджет, КЕП до, остання синхронізація
- [ ] Вхідні документи клієнта
- [ ] Алерти (список)
- [ ] Logout → повертає на логін
- [ ] Сесія зберігається після закриття застосунку

### 3.4 Mobile — Push Notifications (Android APK)

Запуск: `npx eas-cli build --profile preview --platform android` → встановити APK

- [ ] При першому відкритті — запит дозволу на push
- [ ] Після логіну — `usePushNotifications` реєструє token
- [ ] Перевірити в Supabase: `user_settings.expo_push_token` заповнено
- [ ] Тригернути тестовий алерт → прийшов push на телефон
- [ ] Push містить правильний текст (назву клієнта)
- [ ] При кліку на push → застосунок відкривається

### 3.5 Cron Jobs (агент: API Tester)

- [ ] Vercel Dashboard → Functions → `api/cron/sync-all` → logs о 04:00 UTC
- [ ] Лог містить `"synced": 6, "errors": 0`
- [ ] Всі 6 клієнтів мають `"ok": true` в results
- [ ] `api/cron/weekly-digest` → пн 08:00 UTC → Telegram повідомлення

### 3.6 Security (агент: Security Engineer)

- [ ] RLS: user не бачить дані інших users через Supabase
- [ ] KEP: plaintext не з'являється в логах
- [ ] API: всі endpoints повертають 401 без авторизації
- [ ] CORS: backend відповідає тільки на Vercel origin
- [ ] `push-token`: невалідний формат → 400
- [ ] `kep_access_log`: SELECT заблоковано для authenticated role (тільки INSERT)
- [ ] DEK: після використання `buffer.fill(0)` виконується у всіх code paths

### 3.7 Production Readiness (агент: Reality Checker)

- [ ] Vercel deployment: 0 build errors
- [ ] Railway: `/health/ready` → OK
- [ ] Supabase: всі 7 таблиць є, RLS активний
- [ ] KMS: encrypt/decrypt working
- [ ] Cron: остання синхронізація < 48 годин тому
- [ ] Алерти: таблиця не порожня (є хоч один алерт)

---

## 4. Порядок запуску тестів

```
Крок 1: API Tester         → Backend + Cron endpoints
Крок 2: Evidence Collector → Web Dashboard UI
Крок 3: Mobile App Builder → Expo Go flow
Крок 4: Android APK build  → Push тест (якщо є Android)
Крок 5: Security Engineer  → Auth + RLS
Крок 6: Reality Checker    → Production readiness
```

Кроки 1 і 2 можна паралельно.
Крок 6 — тільки після всіх попередніх.

---

## 5. Наступний великий тест — перед першим реальним користувачем

Перед тим як додати першого реального бухгалтера/ФОП:

1. Запустити повний цикл тестів (кроки 1–6)
2. `Reality Checker` має підтвердити READY
3. Перевірити що cron відпрацював мінімум 3 дні поспіль без помилок
4. Перевірити Telegram нотифікації на живому акаунті

---

## 6. Команди для швидкого запуску

```bash
# Expo Go тест (iOS + Android, без push)
cd mobile && npx expo start

# Android APK з push (без Apple Developer)
cd mobile && npx eas-cli build --profile preview --platform android

# iOS build (потребує Apple Developer $99/рік)
cd mobile && npx eas-cli build --profile development --platform ios

# Backend health check
curl https://dps-monitor-production.up.railway.app/health/ready

# KMS test
curl -H "X-Backend-Secret: <BACKEND_API_SECRET>" \
  https://dps-monitor-production.up.railway.app/kms/test

# Тригер cron вручну (для тесту)
curl -X POST \
  -H "Authorization: Bearer <CRON_SECRET>" \
  https://dps-monitor.vercel.app/api/cron/sync-all

# Тижневий дайджест вручну
curl -X POST \
  -H "Authorization: Bearer <CRON_SECRET>" \
  https://dps-monitor.vercel.app/api/cron/weekly-digest
```

---

*Документ оновлювати після кожного спринту.*
