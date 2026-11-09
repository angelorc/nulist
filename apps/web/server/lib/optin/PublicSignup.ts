import { and, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { contacts as contactsTable, listSubscriptions, lists } from '../../db/schema'
import type {
  PublicListInfo,
  PublicSignupResult,
  PublicSubscribeData
} from '../../../shared/schemas/public'
import type { OptInMode } from '../../../shared/types/domain'
import type { ContactService } from '../contacts/ContactService'
import type { Actor } from '../core/actor'
import { DomainError, InvalidStateError, LimitExceededError, NotFoundError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import type { PublicBrandReader } from './PublicBrand'

/** Finds the organization owning a list (PublicContextResolver). */
export interface SignupListResolver {
  fromList(listId: string): Promise<{ readonly publicSignup: PublicSignup }>
}

/** A list of this organization that accepts signups from the public form. */
interface SignupList {
  id: string
  name: string
  description: string | null
  optIn: OptInMode
}

/**
 * Hosted / embedded signup form of one organization. Every outcome produces
 * the same response for a given list, so the form can't be used to find out
 * which addresses are known. Private lists, unknown lists and lists of other
 * organizations all answer the same "not found".
 */
export class PublicSignup {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly contacts: ContactService,
    private readonly brand: PublicBrandReader
  ) {}

  /** The single "this form is not available" answer (no existence leak between lists or organizations). */
  static unavailable(): NotFoundError {
    return new NotFoundError('List')
  }

  /** The signup form of the organization owning `listId`; unknown lists answer like private ones. */
  static async forList(resolver: SignupListResolver, listId: string): Promise<PublicSignup> {
    try {
      return (await resolver.fromList(listId)).publicSignup
    } catch (error) {
      if (error instanceof NotFoundError) throw PublicSignup.unavailable()
      throw error
    }
  }

  /** A list that accepts signups from the public form, with the organization's branding. */
  async publicList(listId: string): Promise<PublicListInfo> {
    const [list, brand] = await Promise.all([this.signupList(listId), this.brand.read()])

    return { ...list, brand }
  }

  async signup(input: PublicSubscribeData, actor: Actor): Promise<PublicSignupResult> {
    const list = await this.signupList(input.listId)
    const result: PublicSignupResult = { ok: true, optIn: list.optIn }

    // Honeypot: bots fill every field. Pretend it worked.
    if (input.website) return result

    try {
      await this.subscribe(input, list, {
        ...actor,
        organizationId: this.scope.organizationId,
        label: 'Signup form'
      })
    } catch (error) {
      if (error instanceof LimitExceededError) {
        throw new DomainError(
          'Signups are temporarily unavailable. Please try again later.',
          503,
          'signups_unavailable'
        )
      }

      // Unsubscribed, bounced or blocked addresses are not resubscribed from a public form.
      if (error instanceof InvalidStateError) return result
      throw error
    }

    return result
  }

  private async signupList(listId: string): Promise<SignupList> {
    const [list] = await this.db
      .select({
        id: lists.id,
        name: lists.name,
        description: lists.description,
        optIn: lists.optIn
      })
      .from(lists)
      .where(
        and(this.scope.eq(lists.organizationId), eq(lists.id, listId), eq(lists.isPublic, true))
      )

    if (!list) throw PublicSignup.unavailable()

    return list
  }

  private async subscribe(
    input: PublicSubscribeData,
    list: SignupList,
    formActor: Actor
  ): Promise<void> {
    const existing = await this.contacts.findByEmail(input.email)

    // An unverified form must not rename existing contacts: only fill missing names.
    const { contact } = await this.contacts.upsert(
      {
        email: input.email,
        firstName: existing?.firstName ? undefined : input.firstName,
        lastName: existing?.lastName ? undefined : input.lastName,
        source: 'form',
        consentIp: existing ? undefined : (formActor.ip ?? undefined)
      },
      formActor
    )

    if (contact.status !== 'active') return

    // list_subscriptions has no organization column: both parents were resolved in this scope.
    const [membership] = await this.db
      .select({ status: listSubscriptions.status })
      .from(listSubscriptions)
      .where(
        and(eq(listSubscriptions.contactId, contact.id), eq(listSubscriptions.listId, list.id))
      )

    if (membership?.status === 'confirmed') return

    // Someone who left a single opt-in list can't be put back by anyone who knows the address;
    // on double opt-in lists the confirmation email proves it is really them.
    if (membership?.status === 'unsubscribed' && list.optIn !== 'double') return

    const outcome = await this.contacts.subscribe(contact.id, list.id, formActor, {
      resubscribe: membership?.status === 'unsubscribed'
    })

    // Single opt-in: the form submission is the consent record.
    if (outcome === 'confirmed') await this.recordConsent(contact.id, formActor.ip ?? null)
  }

  private async recordConsent(contactId: string, ip: string | null): Promise<void> {
    const consent: Partial<typeof contactsTable.$inferInsert> = { consentAt: new Date() }

    if (ip) consent.consentIp = ip

    await this.db
      .update(contactsTable)
      .set(consent)
      .where(and(this.scope.eq(contactsTable.organizationId), eq(contactsTable.id, contactId)))
  }
}
