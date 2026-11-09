import { and, asc, count, eq, inArray, max, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../../db/client'
import { member, session, user } from '../../db/schema'
import { parseRoles } from '../../../shared/auth/permissions'
import type { OrgRole } from '../../../shared/auth/permissions'
import type { MemberDirectory, OrganizationMember } from '../../../shared/schemas/members'
import type { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { ForbiddenError, InvalidStateError, NotFoundError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import type { OrganizationAuthGateway } from './OrganizationAuthGateway'

/** A membership row of the scoped organization, with its user. */
interface MemberRecord {
  id: string
  userId: string
  role: string
  createdAt: Date
  name: string
  email: string
  image: string | null
  banned: boolean | null
}

const OWNER: OrgRole = 'owner'

const uuidSchema = z.uuid()

const MEMBER_COLUMNS = {
  id: member.id,
  userId: member.userId,
  role: member.role,
  createdAt: member.createdAt,
  name: user.name,
  email: user.email,
  image: user.image,
  banned: user.banned
} as const

function isOwner(role: string): boolean {
  return parseRoles(role).includes(OWNER)
}

/**
 * Members of one organization. Reads are scoped by the TenantScope (a member
 * of another organization is "not found"); changes go through Better Auth
 * with the signed-in user's headers (OrganizationAuthGateway), which enforces
 * permissions again and writes the audit entries through its organization hooks.
 */
export class MemberService {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly audit: AuditLogger
  ) {}

  async list(currentUserId: string): Promise<MemberDirectory> {
    const rows = await this.db
      .select(MEMBER_COLUMNS)
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(this.scope.eq(member.organizationId))
      .orderBy(asc(member.createdAt), asc(user.name))

    const activity = await this.lastActive(rows.map((row) => row.userId))

    return {
      members: rows.map((row) =>
        this.toMember(row, currentUserId, activity.get(row.userId) ?? null)
      ),
      ownerCount: rows.filter((row) => isOwner(row.role)).length
    }
  }

  /** A membership of this organization; ids of other organizations are not found. */
  async findOrFail(memberId: string): Promise<MemberRecord> {
    const [row] = uuidSchema.safeParse(memberId).success
      ? await this.db
          .select(MEMBER_COLUMNS)
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .where(and(this.scope.eq(member.organizationId), eq(member.id, memberId)))
      : []

    if (!row) throw new NotFoundError('Member', memberId)

    return row
  }

  /** The membership of `userId` in this organization, or null. */
  async findByUser(userId: string): Promise<MemberRecord | null> {
    const [row] = await this.db
      .select(MEMBER_COLUMNS)
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(this.scope.eq(member.organizationId), eq(member.userId, userId)))

    return row ?? null
  }

  /** Members holding the owner role (roles are stored comma-separated). */
  async countOwners(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(member)
      .where(
        and(
          this.scope.eq(member.organizationId),
          sql`${OWNER} = any(string_to_array(replace(${member.role}, ' ', ''), ','))`
        )
      )

    return row?.value ?? 0
  }

  /**
   * Changes a member's role. Nobody changes their own role, only owners touch
   * owners, and the last owner keeps the role. The new role applies on the
   * member's next request (roles are re-read from the database every time).
   */
  async updateRole(
    memberId: string,
    role: OrgRole,
    actor: Actor,
    gateway: OrganizationAuthGateway
  ): Promise<OrganizationMember> {
    const target = await this.findOrFail(memberId)

    if (parseRoles(target.role).join(',') === role) return this.describe(target, actor)

    if (target.userId === actor.id)
      throw new InvalidStateError("You can't change your own role. Ask another owner or admin.")

    await this.assertCanManage(target, actor)

    if (role === OWNER && !(await this.actorIsOwner(actor)))
      throw new ForbiddenError('Only owners can make someone an owner.')

    await this.withOwnerLock(isOwner(target.role), async () => {
      if (isOwner(target.role) && (await this.countOwners()) <= 1)
        throw new InvalidStateError(
          'The organization needs at least one owner. Make someone else an owner first.'
        )

      await gateway.updateMemberRole(this.scope.organizationId, target.id, role)
    })

    return this.describe(await this.findOrFail(memberId), actor)
  }

  /**
   * Removes a member from this organization; their account and their other
   * memberships are kept. Sessions working in this organization fall back to
   * the user's next organization.
   */
  async remove(memberId: string, actor: Actor, gateway: OrganizationAuthGateway): Promise<void> {
    const target = await this.findOrFail(memberId)

    if (target.userId === actor.id)
      throw new InvalidStateError("You can't remove yourself. Leave the organization instead.")

    await this.assertCanManage(target, actor)

    await this.withOwnerLock(isOwner(target.role), async () => {
      if (isOwner(target.role) && (await this.countOwners()) <= 1)
        throw new InvalidStateError('You cannot remove the last owner of the organization.')

      await gateway.removeMember(this.scope.organizationId, target.id)
    })
    await this.releaseSessions(target.userId)
  }

  /** The signed-in user leaves this organization (Better Auth refuses the last owner). */
  async leave(actor: Actor, gateway: OrganizationAuthGateway): Promise<void> {
    const own = actor.id ? await this.findByUser(actor.id) : null

    if (!own) throw new NotFoundError('Member')

    await this.withOwnerLock(isOwner(own.role), async () => {
      if (isOwner(own.role) && (await this.countOwners()) <= 1)
        throw new InvalidStateError(
          'You are the only owner. Make someone else an owner before you leave.'
        )

      await gateway.leave(this.scope.organizationId)
    })
    await this.releaseSessions(own.userId)
    // Better Auth runs no organization hook for "leave": record it here.
    await this.audit.log(actor, {
      action: 'member.left',
      entityType: 'member',
      entityId: own.id,
      summary: `${own.email} left the organization`,
      changes: { userId: own.userId, email: own.email, role: own.role }
    })
  }

  /**
   * Runs a change that can take an owner away while holding this organization's
   * owner lock (a transaction-scoped advisory lock), so two concurrent demotions,
   * removals or leaves cannot both pass the last-owner check. Better Auth commits
   * the change on its own connection before the lock is released.
   */
  private async withOwnerLock(affectsOwner: boolean, run: () => Promise<void>): Promise<void> {
    if (!affectsOwner) return run()

    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`member-owners:${this.scope.organizationId}`}, 0))`
      )
      await run()
    })
  }

  /** Owners can only be changed or removed by owners (as Better Auth enforces). */
  private async assertCanManage(target: MemberRecord, actor: Actor): Promise<void> {
    if (isOwner(target.role) && !(await this.actorIsOwner(actor)))
      throw new ForbiddenError('Only owners can change or remove another owner.')
  }

  private async actorIsOwner(actor: Actor): Promise<boolean> {
    const own = actor.id ? await this.findByUser(actor.id) : null

    return own !== null && isOwner(own.role)
  }

  /** Sessions of `userId` that work in this organization stop pointing at it. */
  private async releaseSessions(userId: string): Promise<void> {
    await this.db
      .update(session)
      .set({ activeOrganizationId: null })
      .where(
        and(eq(session.userId, userId), eq(session.activeOrganizationId, this.scope.organizationId))
      )
  }

  private async describe(row: MemberRecord, actor: Actor): Promise<OrganizationMember> {
    const activity = await this.lastActive([row.userId])

    return this.toMember(row, actor.id ?? '', activity.get(row.userId) ?? null)
  }

  /** Activity is user-level: the latest session update of each user. */
  private async lastActive(userIds: string[]): Promise<Map<string, Date>> {
    if (!userIds.length) return new Map()

    const rows = await this.db
      .select({ userId: session.userId, at: max(session.updatedAt) })
      .from(session)
      .where(inArray(session.userId, userIds))
      .groupBy(session.userId)

    const activity = new Map<string, Date>()

    for (const row of rows) if (row.at) activity.set(row.userId, row.at)

    return activity
  }

  private toMember(
    row: MemberRecord,
    currentUserId: string,
    lastActive: Date | null
  ): OrganizationMember {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name || row.email,
      email: row.email,
      image: row.image,
      role: row.role,
      isOwner: isOwner(row.role),
      banned: row.banned ?? false,
      createdAt: row.createdAt.toISOString(),
      lastActiveAt: lastActive?.toISOString() ?? null,
      isCurrentUser: row.userId === currentUserId
    }
  }
}
