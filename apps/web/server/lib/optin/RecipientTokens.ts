import type { TenantScope } from '../core/TenantScope'
import { DomainError } from '../core/errors'
import type { RecipientClaims, TokenPurpose, TokenService } from '../security/TokenService'

/**
 * Verifies recipient tokens inside one organization. A token signed for
 * another organization (claim `o`) is rejected as invalid even when its
 * signature is valid: defense in depth behind PublicContextResolver, which
 * already picked this organization from the same claim. Tokens signed before
 * organizations existed carry no `o`; their contact is looked up in the scope.
 */
export class RecipientTokens {
  constructor(
    protected readonly scope: TenantScope,
    private readonly tokens: TokenService
  ) {}

  async verify(purpose: TokenPurpose, token: string): Promise<RecipientClaims> {
    const claims = await this.tokens.verify(purpose, token)

    if (claims.o !== undefined && !this.scope.owns(claims.o)) throw RecipientTokens.invalid()

    return claims
  }

  static invalid(): DomainError {
    return new DomainError('This link is invalid', 400, 'invalid_token')
  }
}
