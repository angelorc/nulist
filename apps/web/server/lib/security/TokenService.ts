import { SignJWT, errors, jwtVerify } from 'jose'
import type { JWTPayload } from 'jose'
import { z } from 'zod'
import { DomainError } from '../core/errors'

export type TokenPurpose = 'unsubscribe' | 'optin' | 'web'

const recipientClaimsSchema = z.object({
  /** contact id */
  c: z.string().min(1),
  /** list id (list-scoped unsubscribe / opt-in) */
  l: z.string().min(1).optional(),
  /** message id */
  m: z.string().min(1).optional(),
  /** topic id */
  t: z.string().min(1).optional(),
  /** organization id; absent in links signed before organizations existed */
  o: z.uuid().optional()
})

/** Claims carried by recipient-facing links. Short keys keep URLs compact. */
export type RecipientClaims = z.infer<typeof recipientClaimsSchema>

/** Claims signed into new links: the organization is always embedded. */
export type SignedRecipientClaims = RecipientClaims & { o: string }

/**
 * Signs and verifies the opaque tokens embedded in unsubscribe, preference,
 * opt-in and web-view links (HS256 JWT via `jose`).
 */
export class TokenService {
  private readonly key: Uint8Array

  constructor(secret: string) {
    this.key = new TextEncoder().encode(`mlist:tokens:${secret}`)
  }

  async sign(
    purpose: TokenPurpose,
    claims: SignedRecipientClaims,
    expiresIn?: string
  ): Promise<string> {
    const jwt = new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience(purpose)
      .setIssuedAt()

    if (expiresIn) jwt.setExpirationTime(expiresIn)

    return jwt.sign(this.key)
  }

  async verify(purpose: TokenPurpose, token: string): Promise<RecipientClaims> {
    const claims = recipientClaimsSchema.safeParse(await this.decode(purpose, token))

    if (!claims.success) throw TokenService.invalid()

    return claims.data
  }

  private async decode(purpose: TokenPurpose, token: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        audience: purpose,
        algorithms: ['HS256']
      })

      return payload
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        throw new DomainError('This link has expired', 410, 'token_expired')
      }

      throw TokenService.invalid()
    }
  }

  private static invalid(): DomainError {
    return new DomainError('This link is invalid', 400, 'invalid_token')
  }
}
