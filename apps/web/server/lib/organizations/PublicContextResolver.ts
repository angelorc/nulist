import type { OrganizationContainer } from '../core/OrganizationContainer'
import { NotFoundError } from '../core/errors'
import type {
  RecipientClaims,
  SignedRecipientClaims,
  TokenPurpose,
  TokenService
} from '../security/TokenService'
import type { OrganizationService } from './OrganizationService'

/** Builds (or reuses) the services of one organization: the root Container. */
export interface OrganizationContainerFactory {
  forOrganization(organizationId: string): OrganizationContainer
}

/** A verified recipient token and the services of the organization it belongs to. */
export interface TokenContext {
  claims: SignedRecipientClaims
  services: OrganizationContainer
}

/**
 * Finds the organization behind an unauthenticated request (unsubscribe and
 * preference links, web views, opt-in confirmations, public signup forms).
 * Tokens carry the organization (`o`); older tokens are resolved through their
 * contact. Unknown entities are "not found", never another organization's data.
 */
export class PublicContextResolver {
  constructor(
    private readonly tokens: TokenService,
    private readonly organizations: OrganizationService,
    private readonly containers: OrganizationContainerFactory
  ) {}

  /** Verifies a recipient token (400 invalid / 410 expired) and resolves its organization. */
  async fromToken(purpose: TokenPurpose, token: string): Promise<TokenContext> {
    const claims = await this.tokens.verify(purpose, token)
    const organizationId = await this.organizationOf(claims)

    if (!organizationId) throw new NotFoundError('Recipient')

    return {
      claims: PublicContextResolver.signed(claims, organizationId),
      services: this.containers.forOrganization(organizationId)
    }
  }

  /** The organization owning a list (public signup forms). */
  async fromList(listId: string): Promise<OrganizationContainer> {
    const organizationId = await this.organizations.organizationOfList(listId)

    if (!organizationId) throw new NotFoundError('List', listId)

    return this.containers.forOrganization(organizationId)
  }

  /** The organization owning a message. */
  async fromMessage(messageId: string): Promise<OrganizationContainer> {
    const organizationId = await this.organizations.organizationOfMessage(messageId)

    if (!organizationId) throw new NotFoundError('Message', messageId)

    return this.containers.forOrganization(organizationId)
  }

  /**
   * The organization signed into the token (when it still exists, so a deleted
   * organization never gets a container), else the contact's (older links).
   */
  private async organizationOf(claims: RecipientClaims): Promise<string | null> {
    if (claims.o) return (await this.organizations.exists(claims.o)) ? claims.o : null

    return this.organizations.organizationOfContact(claims.c)
  }

  private static signed(claims: RecipientClaims, organizationId: string): SignedRecipientClaims {
    return { ...claims, o: organizationId }
  }
}
