import { z } from 'zod'
import type { ApiKeyScope } from '../types/domain'

export interface ApiKeyScopeOption {
  value: ApiKeyScope
  label: string
  description: string
}

/**
 * Scope presets offered when creating a key. The permissions each preset grants
 * are `API_KEY_SCOPES` in shared/auth/permissions (stored on the key).
 */
export const API_KEY_SCOPE_OPTIONS = [
  {
    value: 'sending',
    label: 'Sending only',
    description: 'Transactional email endpoints only. Best for application servers.'
  },
  {
    value: 'full',
    label: 'Full access',
    description: 'Every API endpoint: contacts, lists, broadcasts and sending.'
  }
] as const satisfies readonly ApiKeyScopeOption[]

/** Expiry presets offered in the UI (Better Auth caps custom expiry at 365 days). */
export const API_KEY_EXPIRY_OPTIONS = [
  { label: 'Never', value: 0 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 }
] as const

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(64, 'Keep it under 64 characters'),
  scope: z.enum(['full', 'sending']).default('sending'),
  /** Days until the key expires; 0 or empty = never. */
  expiresInDays: z.coerce.number().int().min(0).max(365).nullish()
})

export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>

/** The member who created a key (keys belong to the organization and outlive them). */
export interface ApiKeyCreator {
  id: string
  name: string
  email: string
}

/** An API key as listed in Settings → API keys (never includes the secret). */
export interface ApiKeySummary {
  id: string
  name: string | null
  /** First characters of the key (including the prefix), safe to display. */
  start: string | null
  prefix: string | null
  enabled: boolean
  scope: ApiKeyScope
  requestCount: number
  lastRequest: string | null
  expiresAt: string | null
  createdAt: string
  /** Null for keys whose creator was deleted or is unknown. */
  createdBy: ApiKeyCreator | null
}

/** Returned exactly once, right after creation. */
export interface CreatedApiKey extends ApiKeySummary {
  key: string
}
