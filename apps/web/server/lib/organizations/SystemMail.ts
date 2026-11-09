import type { Database } from '../../db/client'
import { messages } from '../../db/schema'
import type { Actor } from '../core/actor'
import { DomainError, InvalidStateError, ValidationError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import { formatMailbox } from '../email/mailbox'
import type { DeliveryOutcome, MessageSender } from '../email/MessageSender'
import type { SettingsService } from '../settings/SettingsService'
import type { RenderedEmail, TemplateRenderer } from '../templates/TemplateRenderer'

/** One label/value row in the details table of a system email. */
export interface SystemMailDetail {
  label: string
  value: string
}

/** Content of a system email. Every field is plain text: it is escaped when rendered. */
interface SystemMailContent {
  /** Stored as the `purpose` tag of the message. */
  purpose: 'invitation' | 'test'
  subject: string
  title: string
  intro: string
  action?: { label: string; url: string }
  details: readonly SystemMailDetail[]
  note?: string
}

export interface InvitationMail {
  to: string
  organizationName: string
  inviterName: string
  /** Human label of the invited role (e.g. "Marketer"). */
  roleLabel: string
  url: string
  expiresAt: Date
}

export interface SystemMailResult {
  messageId: string
  from: string
  outcome: DeliveryOutcome
}

const CARD = `<mj-section background-color="#ffffff" border-radius="8px" padding="32px 24px">
      <mj-column>
        <mj-text font-size="20px" line-height="28px" font-weight="600" color="#171717">{{ title }}</mj-text>
        <mj-text>{{ intro }}</mj-text>
        %ACTION%
        <mj-divider border-width="1px" border-color="#e5e5e5" padding="16px 0" />
        <mj-table font-size="13px" line-height="20px" color="#404040">
          {% for row in details %}<tr><td style="color:#737373;padding:2px 16px 2px 0;width:96px">{{ row.label }}</td><td>{{ row.value }}</td></tr>{% endfor %}
        </mj-table>
        <mj-text font-size="13px" line-height="20px" color="#737373">{{ note }}</mj-text>
      </mj-column>
    </mj-section>`

const ACTION = `<mj-button href="{{ action_url }}" align="left" background-color="#171717" color="#ffffff" border-radius="6px" font-size="14px" font-weight="600" inner-padding="10px 18px">{{ action_label }}</mj-button>`

/** Branded layout shared by every system email (header, card, company footer). */
function layout(withAction: boolean): string {
  return `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Geist, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" />
      <mj-text font-size="15px" line-height="24px" color="#404040" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-section padding="32px 0 8px">
      <mj-column>
        <mj-text font-size="13px" font-weight="600" color="#171717">{{ app_name }}</mj-text>
      </mj-column>
    </mj-section>
    ${CARD.replace('%ACTION%', withAction ? ACTION : '')}
    <mj-section padding="24px 0 40px">
      <mj-column>
        <mj-text align="center" font-size="12px" line-height="18px" color="#737373">{{ company.name }}{% if company.address != blank %} · {{ company.address }}{% endif %}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`
}

/**
 * Emails the platform sends on behalf of one organization (invitations, test
 * emails): rendered with a fixed branded layout, recorded as `system` messages
 * and delivered synchronously through the organization's own provider.
 */
export class SystemMail {
  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly sender: MessageSender,
    private readonly renderer: TemplateRenderer
  ) {}

  /** Invitation to join this organization (Better Auth `sendInvitationEmail`). */
  async invitation(mail: InvitationMail): Promise<SystemMailResult> {
    return this.send(mail.to, {
      purpose: 'invitation',
      subject: `${mail.inviterName} invited you to ${mail.organizationName}`,
      title: `Join ${mail.organizationName}`,
      intro: `${mail.inviterName} invited you to work on ${mail.organizationName} as ${mail.roleLabel}.`,
      action: { label: 'Accept invitation', url: mail.url },
      details: [
        { label: 'Organization', value: mail.organizationName },
        { label: 'Role', value: mail.roleLabel },
        { label: 'Expires', value: mail.expiresAt.toUTCString() }
      ],
      note: `If you weren't expecting this invitation, you can ignore this email. Link: ${mail.url}`
    })
  }

  /** Small branded email that proves the sending setup works. */
  async test(to: string, actor: Actor, providerLabel: string): Promise<SystemMailResult> {
    const general = await this.settings.get('general')

    return this.send(to, {
      purpose: 'test',
      subject: `Test email from ${general.appName}`,
      title: 'Your sending setup works',
      intro: `This is a test email from ${general.appName}. If you can read it, messages are leaving through your provider and reaching this inbox.`,
      details: [
        { label: 'Provider', value: providerLabel },
        {
          label: 'From',
          value: formatMailbox(general.defaultFromName, general.defaultFromEmail)
        },
        { label: 'Sent by', value: actor.label },
        { label: 'Sent at', value: new Date().toUTCString() }
      ]
    })
  }

  private async send(to: string, mail: SystemMailContent): Promise<SystemMailResult> {
    const general = await this.settings.get('general')

    if (!general.defaultFromEmail) {
      throw new ValidationError(
        'Set a default from email in Settings → Sending before sending emails.',
        { field: 'defaultFromEmail' }
      )
    }

    const from = formatMailbox(general.defaultFromName, general.defaultFromEmail)

    const content = await this.render(mail.action !== undefined, {
      app_name: general.appName,
      company: { name: general.companyName, address: general.companyAddress },
      subject: mail.subject,
      title: mail.title,
      intro: mail.intro,
      action_label: mail.action?.label ?? '',
      action_url: mail.action?.url ?? '',
      details: mail.details,
      note: mail.note ?? ''
    })

    const [message] = await this.db
      .insert(messages)
      .values(
        this.scope.values({
          kind: 'system' as const,
          toEmail: to,
          fromEmail: from,
          replyTo: general.defaultReplyTo || null,
          subject: content.subject,
          html: content.html,
          text: content.text,
          tags: { purpose: mail.purpose }
        })
      )
      .returning({ id: messages.id })

    if (!message) throw new InvalidStateError('Could not record the email')

    try {
      return {
        messageId: message.id,
        from,
        outcome: await this.sender.deliver({ messageId: message.id, content })
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown provider error'
      await this.sender.markFailed(message.id, reason)

      return { messageId: message.id, from, outcome: { status: 'failed', error: reason } }
    }
  }

  private async render(
    withAction: boolean,
    vars: {
      app_name: string
      company: { name: string; address: string }
      subject: string
      title: string
      intro: string
      action_label: string
      action_url: string
      details: readonly SystemMailDetail[]
      note: string
    }
  ): Promise<RenderedEmail> {
    try {
      const { html } = await this.renderer.compileMjml(layout(withAction))
      const prepared = await this.renderer.prepare({ subject: '{{ subject }}', html })

      return await prepared.render(vars)
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw new InvalidStateError('Could not render the email')
    }
  }
}
