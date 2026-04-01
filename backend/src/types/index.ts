/**
 * Shared domain types for DPS-Monitor backend.
 *
 * DPS API response types are copied from /web/lib/dps/types.ts —
 * kept in sync manually. Do not import across package boundaries at runtime.
 */

// ---------------------------------------------------------------------------
// DPS API types (mirrors /web/lib/dps/types.ts)
// ---------------------------------------------------------------------------

export interface KvedEntry {
  code: string
  name: string
  isPrimary?: boolean
}

export interface TaxpayerProfile {
  name: string
  edrpou: string
  rnokpp: string | null
  status: string
  registrationDate: string
  taxAuthority: string
  accountingType: string
  address?: string
  kvedList?: KvedEntry[]
}

export interface BudgetRow {
  taxName: string
  taxCode: string
  charged: number
  paid: number
  debt: number
  overpayment: number
}

export interface BudgetCalculations {
  calculations: BudgetRow[]
}

export interface DpsApiResponse<T> {
  data: T | null
  error: string | null
  isMock: boolean
}

export interface IncomingDocument {
  id: string
  number: string
  date: string
  type: string
  subject: string
  status: 'new' | 'read' | 'answered'
  fromOrg: string
  hasAttachments: boolean
}

export interface DocumentsList {
  documents: IncomingDocument[]
  total: number
}

export interface TaxReport {
  id: string
  name: string
  formCode: string
  period: string
  submittedAt: string
  status: 'accepted' | 'rejected' | 'processing' | 'pending'
  statusText: string
  regNumber: string
}

export interface ReportsList {
  reports: TaxReport[]
  total: number
}

export interface DpsSession {
  accessToken: string
  expiresIn: number
  taxIdUsed?: string
}

// ---------------------------------------------------------------------------
// Supabase row types (mirrors DB schema from /supabase/migrations/)
// ---------------------------------------------------------------------------

export interface DbClient {
  id: string
  user_id: string
  name: string
  edrpou: string | null
  created_at: string
}

export interface DbApiToken {
  id: string
  client_id: string
  user_id: string
  token_encrypted: string | null
  kep_encrypted: string | null
  kep_password_encrypted: string | null
  kep_ca_name: string | null
  kep_owner_name: string | null
  kep_org_name: string | null
  kep_valid_to: string | null
  kep_tax_id: string | null
  updated_at: string
}

export interface DbDpsCache {
  id: string
  client_id: string
  user_id: string
  data_type: 'profile' | 'budget' | 'documents' | 'archive_flag'
  data: unknown
  fetched_at: string
  is_mock: boolean
}

export interface DbAlert {
  id: string
  user_id: string
  client_id: string
  type: AlertType
  message: string
  data: unknown
  is_read: boolean
  created_at: string
}

export interface DbUserSettings {
  user_id: string
  telegram_chat_id: string | null
  notify_telegram: boolean
  updated_at: string
}

export type AlertType =
  | 'debt_change'
  | 'overpayment'
  | 'status_change'
  | 'new_document'
  | 'kep_expiring'
  | 'kep_expired'
  | 'sync_stale'

// ---------------------------------------------------------------------------
// KEP info (result of parsing a certificate)
// ---------------------------------------------------------------------------

export interface KepInfo {
  taxId: string           // РНОКПП (serialNumber) — always present
  orgTaxId: string | null // ЄДРПОУ (organizationIdentifier) — ЮО only
  ownerName: string
  orgName: string | null
  caName: string
  validTo: Date
}

// ---------------------------------------------------------------------------
// KMS envelope — wraps a KMS-encrypted data key + AES-GCM ciphertext
// ---------------------------------------------------------------------------

export interface KmsEnvelope {
  version: 1
  kmsKeyId: string
  encryptedDataKey: string // base64 — KMS-encrypted AES data key
  iv: string              // base64 — AES-GCM IV (12 bytes)
  tag: string             // base64 — AES-GCM auth tag (16 bytes)
  ciphertext: string      // base64 — AES-GCM encrypted payload
}

// ---------------------------------------------------------------------------
// Express request extensions
// ---------------------------------------------------------------------------

export interface AuthenticatedRequest extends Express.Request {
  apiSecret?: string
}
