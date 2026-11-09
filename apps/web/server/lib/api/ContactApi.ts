import { and, inArray } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { lists } from '../../db/schema'
import type {
  V1Contact,
  V1ContactListQuery,
  V1ContactSummary,
  V1ContactUpdateInput,
  V1ContactUpsertInput,
  V1ContactUpsertResult,
  V1DeletedResource,
  V1Page,
  V1SubscriptionResult
} from '../../../shared/schemas/v1'
import type { ContactDetail, ContactListItem } from '../../../shared/types/contacts'
import type { Actor } from '../core/actor'
import { DomainError, NotFoundError } from '../core/errors'
import { toJsonObject } from '../core/json'
import type { ContactService } from '../contacts/ContactService'
import type { TenantScope } from '../core/TenantScope'
import { V1Presenter } from './V1Presenter'

/**
 * REST API v1 contacts resource of one organization: addresses contacts by
 * email and returns the stable public shape. Business rules stay in the
 * organization's ContactService; lists of another organization are not found.
 */
export class ContactApi {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly contacts: ContactService
  ) {}

  static present(detail: ContactDetail): V1Contact {
    return {
      id: detail.id,
      object: 'contact',
      email: detail.email,
      firstName: detail.firstName,
      lastName: detail.lastName,
      status: detail.status,
      attributes: toJsonObject(detail.attributes),
      lists: detail.subscriptions.map((s) => ({
        id: s.listId,
        name: s.listName,
        status: s.status
      })),
      createdAt: V1Presenter.iso(detail.createdAt),
      updatedAt: V1Presenter.iso(detail.updatedAt)
    }
  }

  static summary(item: ContactListItem): V1ContactSummary {
    return {
      id: item.id,
      object: 'contact',
      email: item.email,
      firstName: item.firstName,
      lastName: item.lastName,
      status: item.status,
      source: item.source,
      listCount: item.listCount,
      lastOpenedAt: V1Presenter.isoOrNull(item.lastOpenedAt),
      createdAt: V1Presenter.iso(item.createdAt)
    }
  }

  private async idFor(email: string): Promise<string> {
    const contact = await this.contacts.findByEmail(email)

    // Another organization's contact behaves exactly like a missing one.
    if (!contact || !this.scope.owns(contact.organizationId))
      throw new NotFoundError('Contact', email)

    return contact.id
  }

  /** Throws NotFoundError for the first list that is not one of the organization's. */
  private async assertListsExist(listIds: readonly string[]): Promise<void> {
    if (!listIds.length) return

    const rows = await this.db
      .select({ id: lists.id })
      .from(lists)
      .where(and(this.scope.eq(lists.organizationId), inArray(lists.id, [...listIds])))

    const found = new Set(rows.map((list) => list.id))
    const missing = listIds.find((id) => !found.has(id))

    if (missing) throw new NotFoundError('List', missing)
  }

  /** Filters match the dashboard's contacts table; a `listId` of another organization is not found. */
  async list(query: V1ContactListQuery): Promise<V1Page<V1ContactSummary>> {
    if (query.listId) await this.assertListsExist([query.listId])
    const page = await this.contacts.list(query)

    return V1Presenter.page(page, (item) => ContactApi.summary(item))
  }

  async get(email: string): Promise<V1Contact> {
    return ContactApi.present(await this.contacts.get(await this.idFor(email)))
  }

  /** Profile, attributes (merged unless `attributesMode: 'replace'`) and status, as the dashboard edits them. */
  async update(email: string, input: V1ContactUpdateInput, actor: Actor): Promise<V1Contact> {
    const id = await this.idFor(email)
    await this.contacts.update(id, input, actor)

    return ContactApi.present(await this.contacts.get(id))
  }

  /** Creates or updates by email, then subscribes to `listIds` (each list reports its own outcome). */
  async upsert(input: V1ContactUpsertInput, actor: Actor): Promise<V1ContactUpsertResult> {
    const listIds = [...new Set(input.listIds)]

    await this.assertListsExist(listIds)

    const { contact, created } = await this.contacts.upsert(
      {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        attributes: input.attributes,
        source: 'api',
        consentIp: actor.ip ?? null
      },
      actor
    )

    const subscriptions: V1SubscriptionResult[] = []

    for (const listId of listIds) {
      try {
        const status = await this.contacts.subscribe(contact.id, listId, actor, {
          skipOptIn: input.skipOptIn
        })

        subscriptions.push({ listId, status })
      } catch (error) {
        // A list the contact left, or a bounced/unsubscribed contact: report and continue.
        if (error instanceof DomainError && error.status < 500 && error.code !== 'not_found') {
          subscriptions.push({ listId, status: 'skipped', reason: error.message })
          continue
        }

        throw error
      }
    }

    return { ...ContactApi.present(await this.contacts.get(contact.id)), created, subscriptions }
  }

  async delete(email: string, actor: Actor): Promise<V1DeletedResource> {
    const id = await this.idFor(email)
    await this.contacts.delete(id, actor)

    return { id, object: 'contact', deleted: true }
  }

  /** Unsubscribes from one list, or from every email when `listId` is omitted. */
  async unsubscribe(email: string, listId: string | undefined, actor: Actor): Promise<V1Contact> {
    const id = await this.idFor(email)

    if (listId) await this.assertListsExist([listId])
    await this.contacts.unsubscribe(id, listId ?? null, actor, 'api')

    return ContactApi.present(await this.contacts.get(id))
  }
}
