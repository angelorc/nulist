import { and, asc, count, eq, gt, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../../db/client'
import {
  apikey,
  broadcasts,
  contacts,
  imports,
  invitation,
  lists,
  member,
  messages,
  organization,
  session,
  webhookDeliveries
} from '../../db/schema'
import type {
  LimitSettings,
  OrganizationMembership,
  OrganizationSummary
} from '../../../shared/types/domain'
import type { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { NotFoundError } from '../core/errors'
import type { SettingsInput, SettingsService } from '../settings/SettingsService'

/** What the service needs from an organization's container (its settings). */
export interface OrganizationTenant {
  readonly settings: SettingsService
}

export interface OrganizationTenantResolver {
  forOrganization(organizationId: string): OrganizationTenant
}

/** Why a session has no usable organization. */
export type ActiveMembershipResult =
  | { status: 'ok'; membership: OrganizationMembership }
  /** The user belongs to no organization. */
  | { status: 'none' }
  /** The session points at an organization the user no longer belongs to. */
  | { status: 'not_member'; organizationId: string }
  /** The session row is gone or expired (signed out everywhere, revoked, banned). */
  | { status: 'no_session' }

const uuidSchema = z.uuid()

const SUMMARY = {
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
  logo: organization.logo
} as const

/**
 * Instance-level organization operations (no tenant scope): memberships of a
 * user, the active organization of a session, first-user bootstrap, the
 * instance administrator's list/limits, and resolvers that find the
 * organization of an entity for system code (workflows started before
 * organizations existed, public links, provider events).
 */
export class OrganizationService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditLogger,
    private readonly tenants: OrganizationTenantResolver
  ) {}

  // ---------------------------------------------------------------------------
  // Memberships
  // ---------------------------------------------------------------------------

  /** The user's membership in `organizationId`, or null (re-checked on every request). */
  async membership(userId: string, organizationId: string): Promise<OrganizationMembership | null> {
    if (!uuidSchema.safeParse(organizationId).success) return null

    const [row] = await this.db
      .select({ ...SUMMARY, role: member.role })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))

    return row ?? null
  }

  /** Every organization the user belongs to, oldest membership first. */
  async listForUser(userId: string): Promise<OrganizationMembership[]> {
    return this.db
      .select({ ...SUMMARY, role: member.role })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId))
      .orderBy(asc(member.createdAt), asc(organization.name))
  }

  /**
   * The organization a session works in, read from the session row (the cookie
   * cache may be stale) and re-checked against `member`. A revoked or expired
   * session (no live row) is `no_session`, whatever the cookie cache says. A
   * session without an active organization falls back to the user's first
   * membership, which is then stored on the session.
   */
  async activeMembership(sessionId: string, userId: string): Promise<ActiveMembershipResult> {
    const [row] = await this.db
      .select({ organizationId: session.activeOrganizationId })
      .from(session)
      .where(this.liveSession(sessionId, userId))

    if (!row) return { status: 'no_session' }

    const active = row.organizationId

    if (active) {
      const membership = await this.membership(userId, active)

      return membership
        ? { status: 'ok', membership }
        : { status: 'not_member', organizationId: active }
    }

    const [first] = await this.listForUser(userId)

    if (!first) return { status: 'none' }
    await this.setActive(sessionId, first.id)

    return { status: 'ok', membership: first }
  }

  /** Whether the session row still exists and has not expired (the cookie cache may outlive it). */
  async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: session.id })
      .from(session)
      .where(this.liveSession(sessionId, userId))

    return row !== undefined
  }

  /** Stores the active organization on one session row. */
  async setActive(sessionId: string, organizationId: string | null): Promise<void> {
    await this.db
      .update(session)
      .set({ activeOrganizationId: organizationId })
      .where(eq(session.id, sessionId))
  }

  async get(organizationId: string): Promise<OrganizationSummary> {
    const [row] = uuidSchema.safeParse(organizationId).success
      ? await this.db.select(SUMMARY).from(organization).where(eq(organization.id, organizationId))
      : []

    if (!row) throw new NotFoundError('Organization', organizationId)

    return row
  }

  /** Whether the organization still exists (claims signed into links can outlive it). */
  async exists(organizationId: string): Promise<boolean> {
    if (!uuidSchema.safeParse(organizationId).success) return false

    const [row] = await this.db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, organizationId))

    return row !== undefined
  }

  async hasPendingInvitationFor(email: string): Promise<boolean> {
    const [row] = await this.db
      .select({ value: count() })
      .from(invitation)
      .where(
        and(
          sql`lower(${invitation.email}) = ${email.trim().toLowerCase()}`,
          eq(invitation.status, 'pending'),
          gt(invitation.expiresAt, new Date())
        )
      )

    return (row?.value ?? 0) > 0
  }

  /**
   * First account of the instance: owner of the "Default" organization (the
   * one left by the migration, or a new one), active on the user's sessions.
   * No-op once any membership exists.
   */
  async adoptFirstUser(userId: string): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`lock table ${member} in share row exclusive mode`)
      const [members] = await tx.select({ value: count() }).from(member)

      if ((members?.value ?? 0) > 0) return null

      const [existing] = await tx
        .select({ id: organization.id })
        .from(organization)
        .orderBy(sql`${organization.slug} <> 'default'`, asc(organization.createdAt))
        .limit(1)

      const organizationId =
        existing?.id ??
        (
          await tx
            .insert(organization)
            .values({ name: 'Default', slug: 'default', createdAt: new Date() })
            .returning({ id: organization.id })
        )[0]?.id

      if (!organizationId) return null
      await tx
        .insert(member)
        .values({ organizationId, userId, role: 'owner', createdAt: new Date() })
      await tx
        .update(session)
        .set({ activeOrganizationId: organizationId })
        .where(eq(session.userId, userId))

      return organizationId
    })
  }

  /** Seeds the general settings of a new organization from its name. */
  async initialize(organizationId: string, name: string): Promise<void> {
    await this.tenants.forOrganization(organizationId).settings.initialize(name)
  }

  /**
   * Removes what deleting an organization does not cascade to: its API keys
   * (Better Auth stores the owner as a text `reference_id`, without a foreign key).
   */
  async removeApiKeys(organizationId: string): Promise<void> {
    await this.db.delete(apikey).where(eq(apikey.referenceId, organizationId))
  }

  // ---------------------------------------------------------------------------
  // Instance administration
  // ---------------------------------------------------------------------------

  // The list of every organization with usage is OrganizationDirectory (grouped
  // queries), so listing never builds one container per organization.

  async getLimits(organizationId: string): Promise<LimitSettings> {
    await this.get(organizationId)

    return this.tenants.forOrganization(organizationId).settings.get('limits')
  }

  /** Instance administrators only: sets an organization's quotas. */
  async updateLimits(
    organizationId: string,
    input: SettingsInput<'limits'>,
    actor: Actor
  ): Promise<LimitSettings> {
    const target = await this.get(organizationId)

    const { before, after } = await this.tenants
      .forOrganization(organizationId)
      .settings.updateLimits(input)

    await this.audit.log(
      { ...actor, organizationId },
      {
        action: 'organization.limits_updated',
        entityType: 'organization',
        entityId: organizationId,
        summary: `Updated the limits of ${target.name}`,
        changes: { before, after }
      }
    )

    return after
  }

  private liveSession(sessionId: string, userId: string) {
    return and(
      eq(session.id, sessionId),
      eq(session.userId, userId),
      gt(session.expiresAt, new Date())
    )
  }

  // ---------------------------------------------------------------------------
  // Resolvers for system code
  // ---------------------------------------------------------------------------

  async organizationOfContact(contactId: string): Promise<string | null> {
    if (!uuidSchema.safeParse(contactId).success) return null

    const [row] = await this.db
      .select({ organizationId: contacts.organizationId })
      .from(contacts)
      .where(eq(contacts.id, contactId))

    return row?.organizationId ?? null
  }

  async organizationOfList(listId: string): Promise<string | null> {
    if (!uuidSchema.safeParse(listId).success) return null

    const [row] = await this.db
      .select({ organizationId: lists.organizationId })
      .from(lists)
      .where(eq(lists.id, listId))

    return row?.organizationId ?? null
  }

  async organizationOfMessage(messageId: string): Promise<string | null> {
    if (!uuidSchema.safeParse(messageId).success) return null

    const [row] = await this.db
      .select({ organizationId: messages.organizationId })
      .from(messages)
      .where(eq(messages.id, messageId))

    return row?.organizationId ?? null
  }

  async organizationOfBroadcast(broadcastId: string): Promise<string | null> {
    if (!uuidSchema.safeParse(broadcastId).success) return null

    const [row] = await this.db
      .select({ organizationId: broadcasts.organizationId })
      .from(broadcasts)
      .where(eq(broadcasts.id, broadcastId))

    return row?.organizationId ?? null
  }

  async organizationOfImport(importId: string): Promise<string | null> {
    if (!uuidSchema.safeParse(importId).success) return null

    const [row] = await this.db
      .select({ organizationId: imports.organizationId })
      .from(imports)
      .where(eq(imports.id, importId))

    return row?.organizationId ?? null
  }

  async organizationOfWebhookDelivery(deliveryId: string): Promise<string | null> {
    if (!uuidSchema.safeParse(deliveryId).success) return null

    const [row] = await this.db
      .select({ organizationId: webhookDeliveries.organizationId })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId))

    return row?.organizationId ?? null
  }
}
