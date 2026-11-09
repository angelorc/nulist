import type { messages } from '../../db/schema'
import { parseMailbox } from '../../../shared/schemas/transactional'
import type { TransactionalEmailInput } from '../../../shared/schemas/transactional'
import type { GeneralSettings } from '../../../shared/types/domain'
import type { ContactRow, ContactService } from '../contacts/ContactService'
import type { SenderPolicy } from '../deliverability/SenderPolicy'
import { DomainError, NotFoundError, ValidationError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import type { TopicRow, TopicService } from '../lists/TopicService'
import type { LinkBuilder } from '../security/LinkBuilder'
import { formatMailbox } from '../email/mailbox'
import type {
  RenderedEmail,
  RenderVariables,
  TemplateRenderer
} from '../templates/TemplateRenderer'
import type { TemplateService } from '../templates/TemplateService'
import { RawHtmlContentSource, TemplateContentSource } from './EmailContentSource'
import type { EmailContent, EmailContentSource } from './EmailContentSource'

export type NewMessage = typeof messages.$inferInsert

/** Message values the composer decides; the service adds the organization and request bookkeeping. */
export type ComposedMessage = Omit<
  NewMessage,
  'organizationId' | 'apiKeyId' | 'idempotencyKey' | 'requestHash'
>

/** The organization's services an email is composed from. */
export interface ComposerDependencies {
  scope: TenantScope
  templates: TemplateService
  renderer: TemplateRenderer
  links: LinkBuilder
  contacts: ContactService
  topics: TopicService
  senders: SenderPolicy
}

export interface ComposedEmail {
  /** Row values, minus the organization and request bookkeeping added by the service. */
  values: ComposedMessage
  /** Set when the recipient opted out of the email's topic: stored as suppressed, never sent. */
  optOut: { topicId: string; topicName: string } | null
}

/**
 * Turns one API request into a fully rendered `messages` row: resolves the
 * content source, sender, recipient contact and topic preference, then renders
 * Liquid once so the stored message is exactly what gets delivered.
 * Everything is resolved inside the organization of `deps.scope`: another
 * organization's template, topic or contact behaves as missing.
 * One instance per request: templates and topics are memoized across a batch.
 */
export class TransactionalComposer {
  private readonly contentCache = new Map<string, Promise<EmailContent>>()
  private readonly topicCache = new Map<string, Promise<TopicRow>>()

  constructor(
    private readonly deps: ComposerDependencies,
    private readonly general: GeneralSettings
  ) {}

  async compose(input: TransactionalEmailInput, now = new Date()): Promise<ComposedEmail> {
    const fromEmail = this.sender(input.from)
    await this.deps.senders.assertAllowed(fromEmail)

    const [content, contact, topic] = await Promise.all([
      this.content(input),
      this.contact(input.to),
      input.topicId ? this.topic(input.topicId) : Promise.resolve(null)
    ])

    const accepted = topic ? await this.acceptsTopic(topic, contact) : true
    const rendered = await this.render(content, input, contact, topic)

    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null
    const scheduled = !!scheduledAt && scheduledAt.getTime() > now.getTime()

    return {
      values: {
        kind: 'transactional',
        contactId: contact?.id ?? null,
        templateId: content.templateId,
        topicId: topic?.id ?? null,
        toEmail: input.to,
        fromEmail,
        replyTo: input.replyTo ?? (this.general.defaultReplyTo || null),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        variables: input.data ?? {},
        tags: input.tags ?? {},
        status: !accepted ? 'suppressed' : scheduled ? 'scheduled' : 'queued',
        error:
          !accepted && topic
            ? `Not sent: the recipient opted out of the "${topic.name}" topic`
            : null,
        scheduledAt: scheduled ? scheduledAt : null
      },
      optOut: !accepted && topic ? { topicId: topic.id, topicName: topic.name } : null
    }
  }

  private sender(from: string | undefined): string {
    if (from) {
      const { name, email } = parseMailbox(from)

      return formatMailbox(name ?? '', email.toLowerCase())
    }

    if (!this.general.defaultFromEmail) {
      throw new ValidationError(
        'Pass "from", or set a default sender email in Settings → General.',
        { field: 'from' }
      )
    }

    return formatMailbox(this.general.defaultFromName, this.general.defaultFromEmail)
  }

  private source(input: TransactionalEmailInput): EmailContentSource {
    if (input.template)
      return new TemplateContentSource(this.deps.scope, this.deps.templates, input.template)

    if (input.html && input.subject)
      return new RawHtmlContentSource(input.subject, input.html, input.text ?? null)
    throw new ValidationError('Provide a template (id or slug), or html and a subject', {
      field: 'template'
    })
  }

  /** Template content is shared across a batch; per-email subject/text overrides are applied on top. */
  private async content(input: TransactionalEmailInput): Promise<EmailContent> {
    const key = input.template ? `template:${input.template.toLowerCase()}` : null
    let pending = key ? this.contentCache.get(key) : undefined

    if (!pending) {
      pending = this.source(input).load()

      if (key) this.contentCache.set(key, pending)
    }

    const base = await pending

    return {
      ...base,
      subject: input.subject ?? base.subject,
      text: input.text ?? base.text
    }
  }

  /** The organization's contact with this address, if any. */
  private async contact(email: string): Promise<ContactRow | null> {
    const contact = await this.deps.contacts.findByEmail(email)

    return contact && this.deps.scope.owns(contact.organizationId) ? contact : null
  }

  private topic(id: string): Promise<TopicRow> {
    let pending = this.topicCache.get(id)

    if (!pending) {
      pending = this.ownedTopic(id)
      this.topicCache.set(id, pending)
    }

    return pending
  }

  private async ownedTopic(id: string): Promise<TopicRow> {
    const topic = await this.deps.topics.findOrFail(id)

    if (!this.deps.scope.owns(topic.organizationId)) throw new NotFoundError('Topic', id)

    return topic
  }

  /** Known contacts follow their preference; unknown recipients get the topic default. */
  private async acceptsTopic(topic: TopicRow, contact: ContactRow | null): Promise<boolean> {
    return contact ? this.deps.topics.isSubscribed(contact.id, topic.id) : topic.defaultSubscribed
  }

  private async variables(
    input: TransactionalEmailInput,
    contact: ContactRow | null,
    topic: TopicRow | null
  ): Promise<RenderVariables> {
    const vars: RenderVariables = {
      contact: contact
        ? {
            id: contact.id,
            email: contact.email,
            first_name: contact.firstName,
            last_name: contact.lastName,
            attributes: contact.attributes
          }
        : { email: input.to },
      data: input.data ?? {},
      company: { name: this.general.companyName, address: this.general.companyAddress }
    }

    if (contact)
      vars.preferences_url = await this.deps.links.preferencesUrl(
        topic ? { c: contact.id, t: topic.id } : { c: contact.id }
      )

    return vars
  }

  private async render(
    content: EmailContent,
    input: TransactionalEmailInput,
    contact: ContactRow | null,
    topic: TopicRow | null
  ): Promise<RenderedEmail> {
    const vars = await this.variables(input, contact, topic)

    try {
      const prepared = await this.deps.renderer.prepare({
        subject: content.subject,
        html: content.html,
        preheader: content.preheader
      })

      const rendered = await prepared.render(vars)

      if (content.text !== null)
        rendered.text = (await this.deps.renderer.renderText(content.text, vars)).trim()

      if (!rendered.subject)
        throw new ValidationError(
          'The subject is empty once rendered. Pass a subject or check the template variables.',
          { field: 'subject' }
        )

      return rendered
    } catch (cause) {
      if (cause instanceof DomainError) throw cause
      const reason = cause instanceof Error ? cause.message : String(cause)
      throw new ValidationError(`The email could not be rendered: ${reason}`, { field: 'data' })
    }
  }
}
