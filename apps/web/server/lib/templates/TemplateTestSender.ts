import type { Database } from '../../db/client'
import { messages } from '../../db/schema'
import type { TemplateTestResult } from '../../../shared/schemas/templates'
import type { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { DomainError, NotFoundError, ValidationError } from '../core/errors'
import type { MessageSender } from '../email/MessageSender'
import type { LimitService } from '../limits/LimitService'
import type { SettingsService } from '../settings/SettingsService'
import type { TemplatePreviewer } from './TemplatePreviewer'
import type { TemplateRenderer } from './TemplateRenderer'
import type { TemplateRow, TemplateService } from './TemplateService'
import { formatMailbox } from '../email/mailbox'
import type { TenantScope } from '../core/TenantScope'

/** A `messages` row before the organization is attached (`scope.values`). */
type NewMessage = Omit<typeof messages.$inferInsert, 'organizationId'>

/**
 * Sends one rendered copy of an organization's template to a single address
 * (kind `system`), using sample variables and the organization's default sender
 * from Settings → General. The message row belongs to the organization, counts
 * against its sending limits and goes out through its provider.
 */
export class TemplateTestSender {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly templates: TemplateService,
    private readonly renderer: TemplateRenderer,
    private readonly previewer: TemplatePreviewer,
    private readonly sender: MessageSender,
    private readonly settings: SettingsService,
    private readonly limits: LimitService,
    private readonly audit: AuditLogger
  ) {}

  async send(template: TemplateRow, to: string, actor: Actor): Promise<TemplateTestResult> {
    // Callers pass a template from the scoped TemplateService; never send another organization's.
    if (!this.scope.owns(template.organizationId)) throw new NotFoundError('Template', template.id)

    const general = await this.settings.get('general')

    if (!general.defaultFromEmail) {
      throw new ValidationError(
        'Set a default sender email in Settings → General before sending a test.',
        { field: 'defaultFromEmail' }
      )
    }

    await this.limits.assertCanSend(1)

    const html = await this.templates.compiledHtml(template)
    const variables = await this.previewer.sampleVariables({ contact: { email: to } })

    const prepared = await this.renderer.prepare({
      subject: template.subject || template.name,
      html,
      preheader: template.preheader
    })

    const rendered = await prepared.render(variables)
    const content = { ...rendered, subject: `[Test] ${rendered.subject}` }

    const row: NewMessage = {
      kind: 'system',
      templateId: template.id,
      toEmail: to,
      fromEmail: formatMailbox(general.defaultFromName, general.defaultFromEmail),
      replyTo: general.defaultReplyTo || null,
      subject: content.subject,
      html: content.html,
      text: content.text,
      variables,
      tags: { purpose: 'template_test', template_id: template.id }
    }

    const [message] = await this.db
      .insert(messages)
      .values(this.scope.values(row))
      .returning({ id: messages.id })

    if (!message) throw new DomainError('Could not queue the test email', 500, 'internal_error')
    const messageId = message.id

    let result: TemplateTestResult

    try {
      const outcome = await this.sender.deliver({ messageId, content })
      result =
        outcome.status === 'sent'
          ? { messageId, status: 'sent' }
          : outcome.status === 'suppressed'
            ? {
                messageId,
                status: 'suppressed',
                error: `${to} is on the suppression list (${outcome.reason.replace(/_/g, ' ')})`
              }
            : { messageId, status: 'failed', error: outcome.error }
    } catch (error) {
      // Retryable provider errors are re-thrown by the sender; a test send is not retried.
      const reason = error instanceof Error ? error.message : 'Unknown error'
      await this.sender.markFailed(messageId, reason)
      result = { messageId, status: 'failed', error: reason }
    }

    await this.audit.log(actor, {
      action: 'template.test_sent',
      entityType: 'template',
      entityId: template.id,
      summary: `Sent a test of "${template.name}" to ${to}`,
      changes: { messageId, status: result.status }
    })

    return result
  }
}
