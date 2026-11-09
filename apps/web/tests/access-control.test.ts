import { describe, expect, it } from 'vitest'
import { BetterAuthApiKeyVerifier } from '../server/lib/api/ApiKeyVerifier'
import type { BetterAuthVerifyApi } from '../server/lib/api/ApiKeyVerifier'
import {
  isOrgSettingsSection,
  orgSettingsSectionParamsSchema
} from '../server/lib/settings/sections'
import { API_KEY_SCOPES, ROLE_OPTIONS, can, grants } from '../shared/auth/permissions'
import type { OrgRole, PermissionRequest } from '../shared/auth/permissions'

/** A dashboard action and the organization roles allowed to perform it. */
interface RoleRule {
  action: string
  request: PermissionRequest
  allowed: readonly OrgRole[]
}

const ROLE_MATRIX: RoleRule[] = [
  {
    action: 'read contacts',
    request: { contact: ['read'] },
    allowed: ['owner', 'admin', 'editor', 'member']
  },
  {
    action: 'import contacts',
    request: { contact: ['import'] },
    allowed: ['owner', 'admin', 'editor']
  },
  {
    action: 'send a broadcast',
    request: { broadcast: ['send'] },
    allowed: ['owner', 'admin', 'editor']
  },
  { action: 'create an API key', request: { apiKey: ['create'] }, allowed: ['owner', 'admin'] },
  { action: 'list API keys', request: { apiKey: ['read'] }, allowed: ['owner', 'admin'] },
  { action: 'change a member role', request: { member: ['update'] }, allowed: ['owner', 'admin'] },
  { action: 'update settings', request: { settings: ['update'] }, allowed: ['owner', 'admin'] },
  { action: 'read the audit log', request: { audit: ['read'] }, allowed: ['owner', 'admin'] },
  { action: 'delete the organization', request: { organization: ['delete'] }, allowed: ['owner'] }
]

const ROLES: OrgRole[] = ROLE_OPTIONS.map((option) => option.value)

describe('organization roles', () => {
  it('grant each action only to the roles of the access matrix', () => {
    const actual = ROLE_MATRIX.map(({ action, request }) => ({
      action,
      allowed: ROLES.filter((role) => can(role, request))
    }))

    expect(actual).toEqual(ROLE_MATRIX.map(({ action, allowed }) => ({ action, allowed })))
    // Unknown roles grant nothing; a member holding several roles gets the union.
    expect(can('superuser', { contact: ['read'] })).toBe(false)
    expect(can('member,admin', { settings: ['update'] })).toBe(true)
  })

  it('keeps limits out of every settings section an organization can write', () => {
    expect(isOrgSettingsSection('limits')).toBe(false)
    expect(orgSettingsSectionParamsSchema.safeParse({ section: 'limits' }).success).toBe(false)
    expect(orgSettingsSectionParamsSchema.safeParse({ section: 'sending' }).success).toBe(true)
  })
})

/** A key record as the Better Auth apiKey plugin returns it after a successful lookup. */
interface StoredKey {
  description: string
  metadata: string | null
  permissions: string | null
}

const SENDING_KEYS: StoredKey[] = [
  {
    description: 'a sending key',
    metadata: JSON.stringify({ scope: 'sending' }),
    permissions: JSON.stringify(API_KEY_SCOPES.sending)
  },
  {
    description: 'a sending key created before permissions were stored',
    metadata: JSON.stringify({ scope: 'sending' }),
    permissions: null
  }
]

/** Better Auth's verify endpoint, answering with one stored key. */
function keyStore(stored: StoredKey): BetterAuthVerifyApi {
  return {
    verifyApiKey: async () => ({
      valid: true,
      error: null,
      key: {
        id: '0193c0de-0000-7000-8000-000000000001',
        name: 'Server',
        start: 'ml_abc',
        referenceId: '0193c0de-0000-7000-8000-0000000000aa',
        enabled: true,
        metadata: stored.metadata,
        permissions: stored.permissions
      }
    })
  }
}

describe('API key scopes', () => {
  it.each(SENDING_KEYS)('$description can send email but not read contacts', async (stored) => {
    const identity = await new BetterAuthApiKeyVerifier(keyStore(stored)).verify('ml_abc123')

    expect(grants(identity.permissions, { transactional: ['send'] })).toBe(true)
    expect(grants(identity.permissions, { contact: ['read'] })).toBe(false)
    expect(grants(identity.permissions, { broadcast: ['send'] })).toBe(false)
  })

  it('never lets a key manage keys or settings, and unreadable permissions grant nothing', async () => {
    expect(grants(API_KEY_SCOPES.full, { apiKey: ['create'] })).toBe(false)
    expect(grants(API_KEY_SCOPES.full, { settings: ['update'] })).toBe(false)

    const corrupt = await new BetterAuthApiKeyVerifier(
      keyStore({ description: 'corrupt', metadata: null, permissions: '{not json' })
    ).verify('ml_abc123')

    expect(grants(corrupt.permissions, { transactional: ['send'] })).toBe(false)
  })
})
