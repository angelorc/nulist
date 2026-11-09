import { and, eq, ne } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { organization, session } from '../../db/schema'
import type { OrganizationUpdateInput } from '../../../shared/schemas/organization'
import type { OrganizationSummary } from '../../../shared/types/domain'
import { ConflictError, NotFoundError, ValidationError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import type { OrganizationAuthGateway, OrganizationChanges } from './OrganizationAuthGateway'

const SUMMARY = {
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
  logo: organization.logo
} as const

/**
 * Name, slug and logo of one organization, and its deletion. Changes go
 * through Better Auth with the signed-in user's headers (organization:update /
 * organization:delete) and are audited by its organization hooks; deleting
 * cascades to every tenant row.
 */
export class OrganizationProfile {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database
  ) {}

  async get(): Promise<OrganizationSummary> {
    const [row] = await this.db
      .select(SUMMARY)
      .from(organization)
      .where(eq(organization.id, this.scope.organizationId))

    if (!row) throw new NotFoundError('Organization', this.scope.organizationId)

    return row
  }

  /** Applies the changed fields; a slug taken by another organization is a conflict. */
  async update(
    input: OrganizationUpdateInput,
    gateway: OrganizationAuthGateway
  ): Promise<OrganizationSummary> {
    const current = await this.get()
    const changes: OrganizationChanges = {}

    if (input.name !== undefined && input.name !== current.name) changes.name = input.name

    if (input.slug !== undefined && input.slug !== current.slug) {
      await this.assertSlugAvailable(input.slug)
      changes.slug = input.slug
    }

    if (input.logo !== undefined && input.logo !== current.logo) changes.logo = input.logo

    if (!Object.keys(changes).length) return current

    await gateway.updateOrganization(this.scope.organizationId, changes)

    return this.get()
  }

  /**
   * Deletes the organization once `confirmSlug` matches its slug. Every session
   * working in it falls back to its user's next organization.
   */
  async delete(confirmSlug: string, gateway: OrganizationAuthGateway): Promise<void> {
    const current = await this.get()

    if (confirmSlug.trim().toLowerCase() !== current.slug)
      throw new ValidationError(`Type ${current.slug} to confirm.`, { field: 'confirmSlug' })

    await gateway.deleteOrganization(this.scope.organizationId)
    await this.db
      .update(session)
      .set({ activeOrganizationId: null })
      .where(eq(session.activeOrganizationId, this.scope.organizationId))
  }

  private async assertSlugAvailable(slug: string): Promise<void> {
    const [taken] = await this.db
      .select({ id: organization.id })
      .from(organization)
      .where(and(eq(organization.slug, slug), ne(organization.id, this.scope.organizationId)))

    if (taken) throw new ConflictError(`The slug ${slug} is already taken.`, 'slug_taken')
  }
}
