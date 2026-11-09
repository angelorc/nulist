import type { PermissionRequest } from '../../../../shared/auth/permissions'
import { callAuth } from '../auth/BetterAuthApi'
import type { BetterAuthApiKeyApi } from '../auth/BetterAuthApi'
import type { ApiKeyMetadata } from './keyMetadata'

export interface IssueKeyInput {
  name: string
  /** Organization that owns the key (Better Auth `referenceId`). */
  organizationId: string
  /** Member creating the key: Better Auth checks they hold `apiKey:create` in the organization. */
  userId: string
  /** What the key may do; authorized locally on every API request. */
  permissions: PermissionRequest
  metadata: ApiKeyMetadata
  /** Seconds until expiry; null = never. */
  expiresIn: number | null
}

export interface IssuedKey {
  id: string
  /** The plain secret: only available right after creation. */
  key: string
}

/** Creates and revokes organization API keys (strategy, so services do not depend on an auth library). */
export interface ApiKeyIssuer {
  issue(input: IssueKeyInput): Promise<IssuedKey>
  /**
   * Revokes a key of the organization on behalf of the signed-in member, whose
   * request `headers` carry the session (they need `apiKey:delete` there).
   */
  revoke(keyId: string, headers: Headers): Promise<void>
}

/**
 * Better Auth apiKey plugin (`references: 'organization'`): hashes keys, applies
 * the `ml_` prefix and stores permissions and metadata. Stateless, so one
 * instance can serve every request.
 */
export class BetterAuthApiKeyIssuer implements ApiKeyIssuer {
  constructor(private readonly api: BetterAuthApiKeyApi) {}

  /** Header-less server call: the only way Better Auth accepts `permissions`. */
  async issue(input: IssueKeyInput): Promise<IssuedKey> {
    const created = await callAuth(() =>
      this.api.createApiKey({
        body: {
          name: input.name,
          organizationId: input.organizationId,
          userId: input.userId,
          expiresIn: input.expiresIn,
          permissions: input.permissions,
          metadata: { scope: input.metadata.scope, createdBy: input.metadata.createdBy }
        }
      })
    )

    return { id: created.id, key: created.key }
  }

  async revoke(keyId: string, headers: Headers): Promise<void> {
    await callAuth(() => this.api.deleteApiKey({ body: { keyId }, headers }))
  }
}
