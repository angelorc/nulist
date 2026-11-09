import type { TenantScope } from '../core/TenantScope'
import type { RecipientClaims, TokenService } from './TokenService'

/** Claims callers provide; the organization claim always comes from the scope. */
export type LinkClaims = Omit<RecipientClaims, 'o'>

/**
 * Builds the public, recipient-facing URLs that go into emails for one
 * organization. Every signed token carries the organization id (`o`), so
 * public pages resolve the tenant from the link itself.
 */
export class LinkBuilder {
  constructor(
    protected readonly scope: TenantScope,
    private readonly appUrl: string,
    private readonly tokens: TokenService
  ) {}

  get baseUrl() {
    return this.appUrl.replace(/\/+$/, '')
  }

  private claims(claims: LinkClaims) {
    return { ...claims, o: this.scope.organizationId }
  }

  /** RFC 8058 one-click endpoint (POST) — GET redirects to the preference center. */
  async unsubscribeUrl(claims: LinkClaims): Promise<string> {
    return `${this.baseUrl}/u/${await this.tokens.sign('unsubscribe', this.claims(claims))}`
  }

  async preferencesUrl(claims: LinkClaims): Promise<string> {
    return `${this.baseUrl}/preferences/${await this.tokens.sign('unsubscribe', this.claims(claims))}`
  }

  async confirmUrl(claims: LinkClaims, expiresInDays: number): Promise<string> {
    return `${this.baseUrl}/confirm/${await this.tokens.sign('optin', this.claims(claims), `${expiresInDays}d`)}`
  }

  async webUrl(claims: LinkClaims): Promise<string> {
    return `${this.baseUrl}/view/${await this.tokens.sign('web', this.claims(claims))}`
  }

  isOwnUrl(url: string): boolean {
    return url.startsWith(this.baseUrl)
  }
}
