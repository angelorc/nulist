import { and, asc, count, eq, gte, inArray, sql } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { contacts, files, member, messages, organization, settings, user } from '../../db/schema'
import { limitSettingsSchema } from '../../../shared/schemas/settings'
import type {
  AdminOrganizationCreateInput,
  AdminOrganizationCreated,
  AdminOrganizationRow
} from '../../../shared/schemas/organization'
import type { LimitSettings, LimitUsage } from '../../../shared/types/domain'
import type { Container } from '../core/Container'
import { ConflictError } from '../core/errors'
import { invitationUrl } from './InvitationService'
import type { OrganizationAuthGateway } from './OrganizationAuthGateway'

/** Message states that count as sent (same as LimitService). */
const SENT_STATUSES = ['sent', 'delivered', 'delayed', 'bounced', 'complained', 'sending'] as const

const storedLimitsSchema = limitSettingsSchema.partial()

/** The instance administrator creating an organization. */
export interface InstanceAdministrator {
  id: string
  email: string
}

/** Per-organization totals, keyed by organization id. */
type Totals = Map<string, number>

function startOfMonth(): Date {
  const start = new Date()
  start.setUTCDate(1)
  start.setUTCHours(0, 0, 0, 0)

  return start
}

/**
 * The instance administrator's view of every organization (no tenant scope):
 * organizations with members and usage against their limits, aggregated with
 * one grouped query per metric, and organization creation for an owner.
 */
export class OrganizationDirectory {
  constructor(
    private readonly db: Database,
    /** Environment defaults the stored limits are merged over. */
    private readonly defaultLimits: LimitSettings,
    /** Public base URL (invitation links). */
    private readonly baseUrl: string
  ) {}

  /** The directory of the platform container (instance administration). */
  static of(platform: Container): OrganizationDirectory {
    return new OrganizationDirectory(
      platform.db,
      platform.defaultSettings.limits,
      platform.config.appUrl
    )
  }

  async list(viewerId: string): Promise<AdminOrganizationRow[]> {
    const [rows, contactTotals, sendTotals, storageTotals, limits, memberships] = await Promise.all(
      [
        this.db
          .select({
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
            logo: organization.logo,
            createdAt: organization.createdAt,
            members: count(member.id)
          })
          .from(organization)
          .leftJoin(member, eq(member.organizationId, organization.id))
          .groupBy(organization.id)
          .orderBy(asc(organization.name)),
        this.contactTotals(),
        this.sendTotals(startOfMonth()),
        this.storageTotals(),
        this.limits(),
        this.db
          .select({ organizationId: member.organizationId })
          .from(member)
          .where(eq(member.userId, viewerId))
      ]
    )

    const mine = new Set(memberships.map((row) => row.organizationId))

    return rows.map((row) => {
      const limit = limits.get(row.id) ?? this.defaultLimits
      const storageBytes = storageTotals.get(row.id) ?? 0

      const usage: LimitUsage[] = [
        {
          key: 'maxContacts',
          label: 'Contacts',
          used: contactTotals.get(row.id) ?? 0,
          limit: limit.maxContacts
        },
        {
          key: 'monthlySendLimit',
          label: 'Emails this month',
          used: sendTotals.get(row.id) ?? 0,
          limit: limit.monthlySendLimit
        },
        {
          key: 'maxStorageMb',
          label: 'File storage',
          used: Math.round((storageBytes / 1024 / 1024) * 10) / 10,
          limit: limit.maxStorageMb,
          unit: 'MB'
        }
      ]

      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        logo: row.logo,
        createdAt: row.createdAt.toISOString(),
        members: row.members,
        isMember: mine.has(row.id),
        usage
      }
    })
  }

  /**
   * Creates an organization owned by `ownerEmail`'s account. Without an account
   * the administrator owns it for now and the email is invited as owner.
   */
  async create(
    input: AdminOrganizationCreateInput,
    administrator: InstanceAdministrator,
    gateway: OrganizationAuthGateway
  ): Promise<AdminOrganizationCreated> {
    await this.assertSlugAvailable(input.slug)

    const [owner] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(sql`lower(${user.email}) = ${input.ownerEmail}`)
      .limit(1)

    const created = await gateway.createOrganizationFor(
      owner?.id ?? administrator.id,
      input.name,
      input.slug
    )

    const summary = {
      id: created.id,
      name: created.name,
      slug: created.slug,
      logo: created.logo ?? null
    }

    if (owner) return { organization: summary, owner: 'member', invitationUrl: null }

    const invitation = await gateway.invite(created.id, input.ownerEmail, 'owner')

    return {
      organization: summary,
      owner: 'invited',
      invitationUrl: invitationUrl(this.baseUrl, invitation.id)
    }
  }

  private async assertSlugAvailable(slug: string): Promise<void> {
    const [taken] = await this.db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, slug))

    if (taken) throw new ConflictError(`The slug ${slug} is already taken.`, 'slug_taken')
  }

  private async contactTotals(): Promise<Totals> {
    const rows = await this.db
      .select({ organizationId: contacts.organizationId, value: count() })
      .from(contacts)
      .groupBy(contacts.organizationId)

    return new Map(rows.map((row) => [row.organizationId, row.value]))
  }

  private async sendTotals(since: Date): Promise<Totals> {
    const rows = await this.db
      .select({ organizationId: messages.organizationId, value: count() })
      .from(messages)
      .where(and(gte(messages.sentAt, since), inArray(messages.status, [...SENT_STATUSES])))
      .groupBy(messages.organizationId)

    return new Map(rows.map((row) => [row.organizationId, row.value]))
  }

  private async storageTotals(): Promise<Totals> {
    const rows = await this.db
      .select({
        organizationId: files.organizationId,
        value: sql<string>`coalesce(sum(${files.size}), 0)::bigint`
      })
      .from(files)
      .groupBy(files.organizationId)

    return new Map(rows.map((row) => [row.organizationId, Number(row.value)]))
  }

  /** Stored limits of every organization merged over the defaults. */
  private async limits(): Promise<Map<string, LimitSettings>> {
    const rows = await this.db
      .select({ organizationId: settings.organizationId, value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'limits'))

    const merged = new Map<string, LimitSettings>()

    for (const row of rows) {
      const stored = storedLimitsSchema.safeParse(row.value)

      // An invalid stored section is ignored (the defaults apply), as in SettingsService.
      if (stored.success) merged.set(row.organizationId, { ...this.defaultLimits, ...stored.data })
    }

    return merged
  }
}
