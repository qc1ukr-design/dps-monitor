/**
 * kepSecurity.test.ts
 *
 * Security tests for KEP envelope encryption service.
 *
 * Coverage:
 *  1. AES-256-GCM ciphertext opacity — plaintext must never appear in the blob
 *  2. Encrypt → Decrypt round-trip correctness with mocked KMS + Supabase
 *  3. No sensitive material in console output during encrypt / decrypt
 *  4. cleanup() zeroes all sensitive buffers and is safe to call twice
 *
 * Всі тести запускаються без реальних AWS або Supabase credentials.
 * Моки підставляють детермінований 32-байтний DEK і in-memory "таблицю".
 */

import { createCipheriv, randomBytes } from 'crypto'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any import of the service
// ---------------------------------------------------------------------------

// Перехоплюємо kmsClient: generateDataKey повертає статичний DEK,
// decryptWithKMS — повертає той самий DEK (симуляція KMS round-trip).
jest.mock('../lib/kmsClient', () => ({
  generateDataKey: jest.fn(),
  decryptWithKMS:  jest.fn(),
  encryptWithKMS:  jest.fn(),
}))

// Перехоплюємо supabase: повертаємо mock-клієнт з in-memory storage.
jest.mock('../lib/supabase', () => ({
  getSupabaseClient: jest.fn(),
}))

import { encryptKep, decryptKep, DecryptedKep } from '../services/kepEncryptionService'
import { generateDataKey, decryptWithKMS } from '../lib/kmsClient'
import { getSupabaseClient } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

// Детермінований 32-байтний ключ для AES-256 (не реальний KMS ключ)
const FAKE_DEK = Buffer.alloc(32, 0xab)

// Фейковий "зашифрований DEK" (те що KMS повертає як ciphertext)
const FAKE_ENCRYPTED_DEK = Buffer.from('fake-kms-wrapped-dek-bytes')

// Тестові дані
const FAKE_KEP_BUFFER   = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33])
const FAKE_PASSWORD      = 'SUPER_SECRET_PASSWORD_12345'
const FAKE_USER_ID       = 'user-test-00000000'
const FAKE_KEP_ID        = 'kep-test-00000000'
const FAKE_KMS_KEY_ID    = 'arn:aws:kms:eu-central-1:123456789012:key/test-key-id'

// ---------------------------------------------------------------------------
// Supabase mock factory
// ---------------------------------------------------------------------------

/**
 * Будує мінімальний mock Supabase-клієнта.
 * `storedRow` — контейнер, в який INSERT пише і з якого SELECT читає.
 * Це дозволяє тесту перевірити що саме зберігається.
 */
function buildSupabaseMock(storedRow: Record<string, unknown> = {}) {
  // Повернення з .single() після insert/select
  const mockSingle = jest.fn()

  // Ланцюжок для kep_credentials insert → .select().single()
  const mockInsertChain = {
    select: jest.fn().mockReturnValue({ single: mockSingle }),
  }

  // Ланцюжок для kep_credentials select → .eq()...maybeSingle()
  const mockMaybeSingle = jest.fn()
  const mockSelectChain = {
    eq: jest.fn().mockReturnThis(),
    maybeSingle: mockMaybeSingle,
  }

  // Ланцюжок для update → .eq()
  const mockUpdateChain = {
    eq:   jest.fn().mockReturnThis(),
    then: jest.fn().mockResolvedValue(undefined),
  }

  // Ланцюжок для kep_access_log insert (audit) — завжди повертає ok
  const mockAuditChain = {
    insert: jest.fn().mockResolvedValue({ error: null }),
  }

  // Головний маршрутизатор .from()
  const mockFrom = jest.fn((table: string) => {
    if (table === 'kep_credentials') {
      return {
        insert:  jest.fn((row: Record<string, unknown>) => {
          // Зберігаємо вставлені дані в storedRow для перевірки в тестах
          Object.assign(storedRow, row)
          return mockInsertChain
        }),
        select:  jest.fn().mockReturnValue(mockSelectChain),
        update:  jest.fn().mockReturnValue(mockUpdateChain),
        delete:  jest.fn().mockReturnThis(),
      }
    }
    // kep_access_log — ігноруємо, просто не кидаємо помилок
    return mockAuditChain
  })

  // Результат insert (повертається через .select().single())
  const insertResult = {
    id:           FAKE_KEP_ID,
    user_id:      FAKE_USER_ID,
    client_id:    null,
    client_name:  'Test Client',
    edrpou:       '12345678',
    file_name:    'test.p12',
    file_size:    FAKE_KEP_BUFFER.length,
    is_active:    true,
    last_used_at: null,
    created_at:   '2026-01-01T00:00:00.000Z',
    updated_at:   '2026-01-01T00:00:00.000Z',
  }
  mockSingle.mockResolvedValue({ data: insertResult, error: null })

  // Результат select для decryptKep — читаємо з storedRow
  mockMaybeSingle.mockImplementation(() => {
    if (Object.keys(storedRow).length === 0) {
      return Promise.resolve({ data: null, error: { message: 'not found' } })
    }
    return Promise.resolve({
      data: {
        encrypted_kep_blob:      storedRow['encrypted_kep_blob'],
        encrypted_password_blob: storedRow['encrypted_password_blob'],
        encrypted_dek:           storedRow['encrypted_dek'],
        kms_key_id:              FAKE_KMS_KEY_ID,
        is_active:               true,
      },
      error: null,
    })
  })

  return { from: mockFrom }
}

// ---------------------------------------------------------------------------
// KMS mock setup
// ---------------------------------------------------------------------------

function setupKmsMocks() {
  // generateDataKey повертає свіжу копію FAKE_DEK щоразу
  // (копію, бо сервіс робить .fill(0) на plaintext після використання)
  ;(generateDataKey as jest.Mock).mockResolvedValue({
    plaintext:  Buffer.from(FAKE_DEK),
    ciphertext: Buffer.from(FAKE_ENCRYPTED_DEK),
  })

  // decryptWithKMS повертає свіжу копію FAKE_DEK
  ;(decryptWithKMS as jest.Mock).mockResolvedValue(Buffer.from(FAKE_DEK))
}

// ---------------------------------------------------------------------------
// Env setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.AWS_KMS_KEY_ID = FAKE_KMS_KEY_ID
})

afterAll(() => {
  delete process.env.AWS_KMS_KEY_ID
})

// ---------------------------------------------------------------------------
// Suite 1: Ciphertext opacity
// ---------------------------------------------------------------------------

describe('Suite 1: Encrypted blobs are opaque (not readable as plaintext)', () => {
  /**
   * Реплікуємо ту саму AES-256-GCM логіку що використовує сервіс,
   * щоб перевірити властивості формату без виклику приватних функцій.
   */
  function replicateAesGcmEncrypt(plaintext: Buffer, key: Buffer): string {
    const iv     = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const ct     = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag    = cipher.getAuthTag()

    return [
      iv.toString('base64'),
      tag.toString('base64'),
      ct.toString('base64'),
    ].join(':')
  }

  const testKey       = Buffer.from(FAKE_DEK)
  const testPlaintext = Buffer.from('SENSITIVE_KEP_FILE_CONTENT_DO_NOT_EXPOSE')

  let blob: string

  beforeEach(() => {
    blob = replicateAesGcmEncrypt(testPlaintext, testKey)
  })

  it('has exactly three colon-separated base64 segments', () => {
    const parts = blob.split(':')
    expect(parts).toHaveLength(3)

    // Кожна частина — валідний base64 (не порожній)
    const base64Regex = /^[A-Za-z0-9+/]+=*$/
    for (const part of parts) {
      expect(part.length).toBeGreaterThan(0)
      expect(base64Regex.test(part)).toBe(true)
    }
  })

  it('does not contain the original plaintext string anywhere in the blob', () => {
    // Перевіряємо всі відомі кодування де може "просочитись" plaintext
    const plaintextStr    = testPlaintext.toString('utf8')
    const plaintextBase64 = testPlaintext.toString('base64')
    const plaintextHex    = testPlaintext.toString('hex')

    expect(blob).not.toContain(plaintextStr)
    expect(blob).not.toContain(plaintextBase64)
    expect(blob).not.toContain(plaintextHex)
  })

  it('ciphertext segment is not valid UTF-8 plaintext equal to input', () => {
    // Декодуємо третю частину (ciphertext) з base64 і переконуємось що вона ≠ оригіналу
    const ctPart    = blob.split(':')[2]
    const ctDecoded = Buffer.from(ctPart, 'base64')

    expect(ctDecoded.equals(testPlaintext)).toBe(false)
    expect(ctDecoded.toString('utf8')).not.toBe(testPlaintext.toString('utf8'))
  })

  it('IV segment decodes to exactly 12 bytes (GCM standard)', () => {
    const ivDecoded = Buffer.from(blob.split(':')[0], 'base64')
    expect(ivDecoded.length).toBe(12)
  })

  it('authentication tag segment decodes to exactly 16 bytes (GCM standard)', () => {
    const tagDecoded = Buffer.from(blob.split(':')[1], 'base64')
    expect(tagDecoded.length).toBe(16)
  })

  it('two encryptions of the same plaintext produce different blobs (IV is random)', () => {
    const blob2 = replicateAesGcmEncrypt(testPlaintext, testKey)
    // Різні IV → різні blobs (з вкрай малою ймовірністю колізії)
    expect(blob).not.toBe(blob2)
  })

  it('password blob does not expose the password string', () => {
    const password      = 'MY_KEP_PASSWORD_TOP_SECRET'
    const passwordBlob  = replicateAesGcmEncrypt(Buffer.from(password, 'utf8'), testKey)

    expect(passwordBlob).not.toContain(password)
    expect(passwordBlob).not.toContain(Buffer.from(password).toString('base64'))
  })
})

// ---------------------------------------------------------------------------
// Suite 2: Round-trip correctness
// ---------------------------------------------------------------------------

describe('Suite 2: Encrypt → Decrypt round-trip preserves original data', () => {
  let storedRow: Record<string, unknown>
  let decrypted: DecryptedKep | null

  beforeEach(() => {
    storedRow = {}
    decrypted = null
    setupKmsMocks()
    ;(getSupabaseClient as jest.Mock).mockReturnValue(buildSupabaseMock(storedRow))
  })

  afterEach(() => {
    // Завжди викликаємо cleanup() у afterEach — навіть якщо тест впав
    if (decrypted !== null) {
      decrypted.cleanup()
      decrypted = null
    }
  })

  it('decryptKep returns the same kepFileBuffer that was passed to encryptKep', async () => {
    const originalBuffer = Buffer.from(FAKE_KEP_BUFFER)

    await encryptKep({
      kepFileBuffer: originalBuffer,
      kepPassword:   FAKE_PASSWORD,
      userId:        FAKE_USER_ID,
      clientId:      'client-001',
      clientName:    'Test Client',
      edrpou:        '12345678',
      fileName:      'test.p12',
    })

    // Переконуємось що зашифровані блоби збережені
    expect(storedRow['encrypted_kep_blob']).toBeTruthy()
    expect(storedRow['encrypted_password_blob']).toBeTruthy()
    expect(storedRow['encrypted_dek']).toBeTruthy()

    decrypted = await decryptKep(FAKE_KEP_ID, FAKE_USER_ID)

    expect(decrypted.kepFileBuffer.equals(originalBuffer)).toBe(true)
  })

  it('decryptKep returns the same kepPassword that was passed to encryptKep', async () => {
    await encryptKep({
      kepFileBuffer: Buffer.from(FAKE_KEP_BUFFER),
      kepPassword:   FAKE_PASSWORD,
      userId:        FAKE_USER_ID,
      clientId:      'client-001',
      clientName:    'Test Client',
      edrpou:        '12345678',
      fileName:      'test.p12',
    })

    decrypted = await decryptKep(FAKE_KEP_ID, FAKE_USER_ID)

    expect(decrypted.kepPassword).toBe(FAKE_PASSWORD)
  })

  it('encrypted_dek stored in DB is base64-encoded (not raw bytes)', async () => {
    await encryptKep({
      kepFileBuffer: Buffer.from(FAKE_KEP_BUFFER),
      kepPassword:   FAKE_PASSWORD,
      userId:        FAKE_USER_ID,
      clientId:      'client-001',
      clientName:    'Test Client',
      edrpou:        '12345678',
      fileName:      'test.p12',
    })

    const storedDek = storedRow['encrypted_dek'] as string
    expect(typeof storedDek).toBe('string')

    // Перевіряємо що це валідний base64
    const decoded = Buffer.from(storedDek, 'base64')
    expect(decoded.length).toBeGreaterThan(0)
    expect(decoded.toString('base64')).toBe(storedDek)
  })

  it('encryptKep result (KepCredential) contains no key material or plaintext', async () => {
    const result = await encryptKep({
      kepFileBuffer: Buffer.from(FAKE_KEP_BUFFER),
      kepPassword:   FAKE_PASSWORD,
      userId:        FAKE_USER_ID,
      clientId:      'client-001',
      clientName:    'Test Client',
      edrpou:        '12345678',
      fileName:      'test.p12',
    })

    // KepCredential не повинен містити жодного з цих полів
    const resultAsRecord = result as Record<string, unknown>
    expect(resultAsRecord['encrypted_kep_blob']).toBeUndefined()
    expect(resultAsRecord['encrypted_password_blob']).toBeUndefined()
    expect(resultAsRecord['encrypted_dek']).toBeUndefined()
    expect(resultAsRecord['kepPassword']).toBeUndefined()
    expect(resultAsRecord['kepFileBuffer']).toBeUndefined()
  })

  it('round-trip works with optional cert metadata fields', async () => {
    await encryptKep({
      kepFileBuffer: Buffer.from(FAKE_KEP_BUFFER),
      kepPassword:   FAKE_PASSWORD,
      userId:        FAKE_USER_ID,
      clientId:      'client-001',
      clientName:    'Test Client',
      edrpou:        '12345678',
      fileName:      'test.p12',
      caName:        'АЦСК ПАТ КБ ПРИВАТБАНК',
      ownerName:     'Іваненко Іван',
      orgName:       'ТОВ Тест',
      taxId:         '1234567890',
      validTo:       '2027-01-01',
    })

    decrypted = await decryptKep(FAKE_KEP_ID, FAKE_USER_ID)

    expect(decrypted.kepPassword).toBe(FAKE_PASSWORD)
    expect(decrypted.kepFileBuffer.equals(Buffer.from(FAKE_KEP_BUFFER))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Suite 3: No sensitive data in console output
// ---------------------------------------------------------------------------

describe('Suite 3: Password and KEP bytes never appear in console output', () => {
  let storedRow: Record<string, unknown>
  let consoleSpy: {
    log:   jest.SpyInstance
    error: jest.SpyInstance
    warn:  jest.SpyInstance
    debug: jest.SpyInstance
  }
  let decrypted: DecryptedKep | null

  beforeEach(() => {
    storedRow = {}
    decrypted = null
    setupKmsMocks()
    ;(getSupabaseClient as jest.Mock).mockReturnValue(buildSupabaseMock(storedRow))

    // Шпигуємо за всіма console-методами
    consoleSpy = {
      log:   jest.spyOn(console, 'log').mockImplementation(() => undefined),
      error: jest.spyOn(console, 'error').mockImplementation(() => undefined),
      warn:  jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      debug: jest.spyOn(console, 'debug').mockImplementation(() => undefined),
    }
  })

  afterEach(() => {
    if (decrypted !== null) {
      decrypted.cleanup()
      decrypted = null
    }
    jest.restoreAllMocks()
  })

  /**
   * Допоміжна функція: повертає всі рядки що були передані в console.*
   */
  function getAllConsoleOutput(): string {
    const allCalls = [
      ...consoleSpy.log.mock.calls,
      ...consoleSpy.error.mock.calls,
      ...consoleSpy.warn.mock.calls,
      ...consoleSpy.debug.mock.calls,
    ]
    return allCalls
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n')
  }

  it('encryptKep does not log the KEP password to any console method', async () => {
    await encryptKep({
      kepFileBuffer: Buffer.from(FAKE_KEP_BUFFER),
      kepPassword:   FAKE_PASSWORD,
      userId:        FAKE_USER_ID,
      clientId:      'client-001',
      clientName:    'Test Client',
      edrpou:        '12345678',
      fileName:      'test.p12',
    })

    const output = getAllConsoleOutput()
    expect(output).not.toContain(FAKE_PASSWORD)
  })

  it('encryptKep does not log raw KEP file bytes to any console method', async () => {
    await encryptKep({
      kepFileBuffer: Buffer.from(FAKE_KEP_BUFFER),
      kepPassword:   FAKE_PASSWORD,
      userId:        FAKE_USER_ID,
      clientId:      'client-001',
      clientName:    'Test Client',
      edrpou:        '12345678',
      fileName:      'test.p12',
    })

    const output = getAllConsoleOutput()
    // Перевіряємо за hex-представленням перших байтів KEP буфера
    const kepHexPattern = FAKE_KEP_BUFFER.slice(0, 4).toString('hex')
    expect(output).not.toContain(kepHexPattern)
  })

  it('decryptKep does not log the KEP password to any console method', async () => {
    // Спочатку шифруємо щоб заповнити storedRow
    await encryptKep({
      kepFileBuffer: Buffer.from(FAKE_KEP_BUFFER),
      kepPassword:   FAKE_PASSWORD,
      userId:        FAKE_USER_ID,
      clientId:      'client-001',
      clientName:    'Test Client',
      edrpou:        '12345678',
      fileName:      'test.p12',
    })

    // Скидаємо spy перед decryptKep — нас цікавить тільки decrypt фаза
    jest.clearAllMocks()

    decrypted = await decryptKep(FAKE_KEP_ID, FAKE_USER_ID)

    const output = getAllConsoleOutput()
    expect(output).not.toContain(FAKE_PASSWORD)
  })

  it('decryptKep does not log raw KEP file bytes to any console method', async () => {
    await encryptKep({
      kepFileBuffer: Buffer.from(FAKE_KEP_BUFFER),
      kepPassword:   FAKE_PASSWORD,
      userId:        FAKE_USER_ID,
      clientId:      'client-001',
      clientName:    'Test Client',
      edrpou:        '12345678',
      fileName:      'test.p12',
    })

    jest.clearAllMocks()

    decrypted = await decryptKep(FAKE_KEP_ID, FAKE_USER_ID)

    const output = getAllConsoleOutput()
    const kepHexPattern = FAKE_KEP_BUFFER.slice(0, 4).toString('hex')
    expect(output).not.toContain(kepHexPattern)
  })

  it('no console method is called with a base64 encoding of the password', async () => {
    const passwordBase64 = Buffer.from(FAKE_PASSWORD, 'utf8').toString('base64')

    await encryptKep({
      kepFileBuffer: Buffer.from(FAKE_KEP_BUFFER),
      kepPassword:   FAKE_PASSWORD,
      userId:        FAKE_USER_ID,
      clientId:      'client-001',
      clientName:    'Test Client',
      edrpou:        '12345678',
      fileName:      'test.p12',
    })

    decrypted = await decryptKep(FAKE_KEP_ID, FAKE_USER_ID)

    const output = getAllConsoleOutput()
    expect(output).not.toContain(passwordBase64)
  })
})

// ---------------------------------------------------------------------------
// Suite 4: cleanup() zeroes sensitive buffers
// ---------------------------------------------------------------------------

describe('Suite 4: cleanup() zeros all sensitive buffers', () => {
  let storedRow: Record<string, unknown>
  let decrypted: DecryptedKep | null

  beforeEach(() => {
    storedRow = {}
    decrypted = null
    setupKmsMocks()
    ;(getSupabaseClient as jest.Mock).mockReturnValue(buildSupabaseMock(storedRow))
  })

  afterEach(() => {
    // Гарантуємо cleanup навіть якщо тест не викликав його явно
    if (decrypted !== null) {
      try { decrypted.cleanup() } catch { /* ігноруємо */ }
      decrypted = null
    }
  })

  async function getDecryptedKep(): Promise<DecryptedKep> {
    await encryptKep({
      kepFileBuffer: Buffer.from(FAKE_KEP_BUFFER),
      kepPassword:   FAKE_PASSWORD,
      userId:        FAKE_USER_ID,
      clientId:      'client-001',
      clientName:    'Test Client',
      edrpou:        '12345678',
      fileName:      'test.p12',
    })

    return decryptKep(FAKE_KEP_ID, FAKE_USER_ID)
  }

  it('kepFileBuffer is fully zeroed after cleanup()', async () => {
    decrypted = await getDecryptedKep()

    // Переконуємось що буфер до cleanup() не є нульовим
    const hasNonZeroBeforeCleanup = decrypted.kepFileBuffer.some(byte => byte !== 0)
    expect(hasNonZeroBeforeCleanup).toBe(true)

    // Зберігаємо посилання на той самий Buffer до cleanup
    const bufferRef = decrypted.kepFileBuffer
    decrypted.cleanup()
    decrypted = null

    // Буфер, на який посилається bufferRef, повинен бути повністю обнулений
    const allZero = bufferRef.every(byte => byte === 0)
    expect(allZero).toBe(true)
  })

  it('calling cleanup() a second time does not throw (idempotent guard)', async () => {
    decrypted = await getDecryptedKep()

    decrypted.cleanup()

    // Другий виклик — не повинен кидати помилку
    expect(() => decrypted!.cleanup()).not.toThrow()

    decrypted = null
  })

  it('kepFileBuffer remains zeroed after a second cleanup() call', async () => {
    decrypted = await getDecryptedKep()
    const bufferRef = decrypted.kepFileBuffer

    decrypted.cleanup()
    decrypted.cleanup() // другий виклик
    decrypted = null

    expect(bufferRef.every(byte => byte === 0)).toBe(true)
  })

  it('kepPassword string is returned as-is (JS strings cannot be zeroed — documented limitation)', async () => {
    // Це не security bug — це задокументоване обмеження Node.js (рядки immutable у V8).
    // passwordBuffer всередині сервісу обнуляється; тут ми просто підтверджуємо що
    // kepPassword доступна до cleanup і що cleanup не кидає помилку.
    decrypted = await getDecryptedKep()

    expect(typeof decrypted.kepPassword).toBe('string')
    expect(decrypted.kepPassword).toBe(FAKE_PASSWORD)

    // Не кидає помилку
    expect(() => decrypted!.cleanup()).not.toThrow()
    decrypted = null
  })

  it('buffer is zeroed even when buffer length matches original KEP bytes length', async () => {
    decrypted = await getDecryptedKep()

    // Довжина буфера після розшифровки повинна відповідати оригінальному вхідному буферу
    expect(decrypted.kepFileBuffer.length).toBe(FAKE_KEP_BUFFER.length)

    const bufferRef = decrypted.kepFileBuffer
    decrypted.cleanup()
    decrypted = null

    // Всі байти — нулі
    expect(Array.from(bufferRef)).toEqual(new Array(FAKE_KEP_BUFFER.length).fill(0))
  })
})
