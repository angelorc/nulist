import { eq, inArray, notInArray, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { instanceSettings, session, user } from '../../db/schema'
import {
  accessSettingsSchema,
  emailDomain,
  SIGN_IN_ERROR_CODES
} from '../../../shared/schemas/access'
import type { AccessSettings, AccessSettingsInput } from '../../../shared/schemas/access'
import type { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { ForbiddenError, ValidationError } from '../core/errors'

export class EmailDomainNotAllowedError extends ForbiddenError {
  constructor() {
    super(
      'Your email domain is not allowed to sign in to this instance.',
      SIGN_IN_ERROR_CODES.domainNotAllowed
    )
  }
}

export interface AccessUpdateResult {
  settings: AccessSettings
  revokedSessions: number
}

const DEFAULT_ACCESS: AccessSettings = { allowedDomains: [] }

const USER_DOMAIN = sql<string>`lower(substring(${user.email} from '[^@]+$'))`

export class AccessPolicy {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditLogger
  ) {}

  async settings(): Promise<AccessSettings> {
    const [row] = await this.db
      .select({ value: instanceSettings.value })
      .from(instanceSettings)
      .where(eq(instanceSettings.key, 'access'))

    const parsed = accessSettingsSchema.safeParse(row?.value)

    return parsed.success ? parsed.data : DEFAULT_ACCESS
  }

  async allows(email: string): Promise<boolean> {
    const { allowedDomains } = await this.settings()

    return AccessPolicy.matches(allowedDomains, email)
  }

  async assertAllowed(email: string): Promise<void> {
    if (!(await this.allows(email))) throw new EmailDomainNotAllowedError()
  }

  async update(
    input: AccessSettingsInput,
    actor: Actor,
    actorEmail: string
  ): Promise<AccessUpdateResult> {
    const next = accessSettingsSchema.parse(input)

    if (!AccessPolicy.matches(next.allowedDomains, actorEmail))
      throw new ValidationError(
        `Add ${emailDomain(actorEmail) || 'your own domain'} to the list: you would lock yourself out.`,
        { field: 'allowedDomains' }
      )

    const previous = await this.settings()

    return this.db.transaction(async (tx) => {
      await tx
        .insert(instanceSettings)
        .values({ key: 'access', value: next })
        .onConflictDoUpdate({
          target: instanceSettings.key,
          set: { value: next, updatedAt: new Date() }
        })

      const revoked = next.allowedDomains.length
        ? await tx
            .delete(session)
            .where(
              inArray(
                session.userId,
                tx
                  .select({ id: user.id })
                  .from(user)
                  .where(notInArray(USER_DOMAIN, next.allowedDomains))
              )
            )
            .returning({ id: session.id })
        : []

      await this.audit.log(
        actor,
        {
          action: 'access.updated',
          entityType: 'instance',
          summary: next.allowedDomains.length
            ? `Restricted sign-in to ${next.allowedDomains.join(', ')}`
            : 'Allowed sign-in from any email domain',
          changes: {
            allowedDomains: { from: previous.allowedDomains, to: next.allowedDomains },
            revokedSessions: revoked.length
          }
        },
        tx
      )

      return { settings: next, revokedSessions: revoked.length }
    })
  }

  static matches(allowedDomains: readonly string[], email: string): boolean {
    if (!allowedDomains.length) return true

    return allowedDomains.includes(emailDomain(email))
  }
}
