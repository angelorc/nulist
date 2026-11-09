import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { contacts, messages } from '../../db/schema'
import type { broadcasts } from '../../db/schema'
import type { BroadcastTestDelivery } from '../../../shared/types/broadcasts'
import { DomainError, ValidationError } from '../core/errors'
import { toJsonObject } from '../core/json'
import type { TenantScope } from '../core/TenantScope'
import type { MessageSender } from '../email/MessageSender'
import type { LimitService } from '../limits/LimitService'
import type { TemplateService } from '../templates/TemplateService'
import { BroadcastContent } from './BroadcastContent'
import type { RecipientContact } from './BroadcastContent'

type BroadcastRow = typeof broadcasts.$inferSelect

/**
 * Sends `[Test]` copies of a draft to a few addresses right away (kind `system`,
 * not counted in the report). Addresses that belong to a contact of the
 * organization are rendered with that contact's data and real preference and
 * web-view links; others (including contacts of other organizations) use sample
 * data. The unsubscribe link is always inert and no List-Unsubscribe header is
 * sent: a test is not sent to the broadcast's lists, so unsubscribing from it
 * would unsubscribe the contact from everything.
 */
export class BroadcastTestSender {
  constructor(
    private readonly scope: TenantScope,
    private readonly db: Database,
    private readonly templates: TemplateService,
    private readonly content: BroadcastContent,
    private readonly sender: MessageSender,
    private readonly limits: LimitService
  ) {}

  async send(broadcast: BroadcastRow, emails: string[]): Promise<BroadcastTestDelivery[]> {
    const from = BroadcastContent.sender(broadcast)

    if (!from)
      throw new ValidationError('Add a sender email address before sending a test.', {
        field: 'fromEmail'
      })
    await this.sender.senders.assertAllowed(from, 'fromEmail')

    if (!broadcast.templateId)
      throw new ValidationError('Choose a template before sending a test.', { field: 'templateId' })

    if (!broadcast.subject.trim())
      throw new ValidationError('Write a subject before sending a test.', { field: 'subject' })

    const addresses = [...new Set(emails.map((e) => e.trim().toLowerCase()))]
    await this.limits.assertCanSend(addresses.length)

    const template = await this.templates.findOrFail(broadcast.templateId)
    const html = await this.templates.compiledHtml(template)
    const prepared = await this.content.prepare(broadcast, html)
    const company = await this.content.company()
    const known = await this.contactsByEmail(addresses)

    const results: BroadcastTestDelivery[] = []

    for (const email of addresses) {
      const contact = known.get(email)

      const [message] = await this.db
        .insert(messages)
        .values(
          this.scope.values({
            kind: 'system' as const,
            contactId: contact?.id ?? null,
            templateId: template.id,
            topicId: broadcast.topicId,
            toEmail: email,
            fromEmail: from,
            replyTo: broadcast.replyTo,
            subject: broadcast.subject,
            tags: { purpose: 'broadcast_test', broadcast_id: broadcast.id }
          })
        )
        .returning({ id: messages.id })

      if (!message) throw new DomainError('Could not queue the test email', 500, 'internal_error')

      results.push(await this.deliver(message.id, email, contact ?? null, prepared, company))
    }

    return results
  }

  private async deliver(
    messageId: string,
    email: string,
    contact: RecipientContact | null,
    prepared: Awaited<ReturnType<BroadcastContent['prepare']>>,
    company: { name: string; address: string }
  ): Promise<BroadcastTestDelivery> {
    const personalized = contact !== null

    try {
      const placeholders = this.content.placeholderLinks()

      const links = contact
        ? {
            ...(await this.content.recipientLinks(contact.id, messageId)),
            unsubscribe_url: placeholders.unsubscribe_url
          }
        : placeholders

      const vars = this.content.variables(
        contact ? BroadcastContent.contactVariables(contact) : this.content.sampleContact(email),
        links,
        company
      )

      const rendered = await prepared.render(vars)
      const content = { ...rendered, subject: `[Test] ${rendered.subject}` }
      await this.db
        .update(messages)
        .set({ html: content.html, text: content.text, variables: toJsonObject(vars) })
        .where(and(this.scope.eq(messages.organizationId), eq(messages.id, messageId)))

      const outcome = await this.sender.deliver({ messageId, content, unsubscribeUrl: null })

      if (outcome.status === 'sent') return { email, messageId, status: 'sent', personalized }

      if (outcome.status === 'suppressed') {
        return {
          email,
          messageId,
          status: 'suppressed',
          personalized,
          error: `${email} is on the suppression list (${outcome.reason.replace(/_/g, ' ')})`
        }
      }

      return { email, messageId, status: 'failed', personalized, error: outcome.error }
    } catch (error) {
      // Retryable provider errors are re-thrown by the sender; a test is not retried.
      const reason = error instanceof Error ? error.message : 'Unknown error'
      await this.sender.markFailed(messageId, reason)

      return { email, messageId, status: 'failed', personalized, error: reason }
    }
  }

  private async contactsByEmail(emails: string[]): Promise<Map<string, RecipientContact>> {
    if (!emails.length) return new Map()

    const rows = await this.db
      .select({
        id: contacts.id,
        email: contacts.email,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        attributes: contacts.attributes
      })
      .from(contacts)
      .where(and(this.scope.eq(contacts.organizationId), inArray(contacts.email, emails)))

    return new Map(rows.map((row) => [row.email.toLowerCase(), row]))
  }
}
