import { and, desc, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { auditLogs } from '../../db/schema'
import type { broadcasts } from '../../db/schema'
import type {
  BroadcastPreflight,
  ChecklistItem,
  ChecklistKey,
  ChecklistStatus
} from '../../../shared/types/broadcasts'
import type { SendingSettings } from '../../../shared/types/domain'
import { hasAudienceSources } from '../../../shared/schemas/broadcasts'
import { DomainError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import type { SenderPolicy } from '../deliverability/SenderPolicy'
import type { LimitService } from '../limits/LimitService'
import type { BroadcastAudience } from './BroadcastAudience'
import type { SettingsService } from '../settings/SettingsService'
import type { TemplateRenderer } from '../templates/TemplateRenderer'
import type { TemplateService } from '../templates/TemplateService'
import { BroadcastContent } from './BroadcastContent'

type BroadcastRow = typeof broadcasts.$inferSelect

export const TEST_SENT_ACTION = 'broadcast.test_sent'

const numberFmt = new Intl.NumberFormat('en-US')

interface TemplateCheck {
  name: string | null
  error: string | null
  hasUnsubscribeLink: boolean
  hasCompanyAddress: boolean
  transactional: boolean
}

function item(
  key: ChecklistKey,
  label: string,
  status: ChecklistStatus,
  detail: string
): ChecklistItem {
  return { key, label, status, detail }
}

function plural(count: number, word: string) {
  return `${numberFmt.format(count)} ${word}${count === 1 ? '' : 's'}`
}

/**
 * Pre-flight checks shown next to the composer and enforced before a
 * broadcast is scheduled. Blockers prevent sending; warnings are advice.
 * Settings, limits, audience and templates are the organization's own.
 */
export class BroadcastPreflightCheck {
  constructor(
    private readonly scope: TenantScope,
    private readonly db: Database,
    private readonly audience: BroadcastAudience,
    private readonly templates: TemplateService,
    private readonly renderer: TemplateRenderer,
    private readonly settings: SettingsService,
    private readonly limits: LimitService,
    private readonly senders: SenderPolicy
  ) {}

  async evaluate(broadcast: BroadcastRow): Promise<BroadcastPreflight> {
    const [general, sending, recipients, capacity, lastTest, template, sender] = await Promise.all([
      this.settings.get('general'),
      this.settings.get('sending'),
      this.recipientCount(broadcast),
      this.limits.remainingSendCapacity(),
      this.lastTest(broadcast.id),
      this.checkTemplate(broadcast.templateId),
      this.senderItem(broadcast)
    ])

    const items: ChecklistItem[] = [
      this.audienceItem(broadcast, recipients),
      sender,
      this.sendingItem(sending),
      this.subjectItem(broadcast.subject),
      this.templateItem(template),
      this.unsubscribeItem(template),
      broadcast.preheader
        ? item('preheader', 'Preview text', 'ok', broadcast.preheader)
        : item(
            'preheader',
            'Preview text',
            'warning',
            'Add preview text: inboxes show it next to the subject.'
          ),
      this.addressItem(general.companyAddress, template),
      lastTest
        ? item('test', 'Test email', 'ok', 'A test was sent and delivered to the provider.')
        : item(
            'test',
            'Test email',
            'warning',
            'Send yourself a test to check rendering and links.'
          ),
      this.capacityItem(capacity, recipients)
    ]

    const rate = Math.max(1, sending.ratePerSecond)

    return {
      items,
      recipients,
      ready: !items.some((i) => i.status === 'blocker'),
      durationSeconds: Math.ceil(recipients / rate),
      ratePerSecond: rate,
      lastTestAt: lastTest?.toISOString() ?? null
    }
  }

  async recipientCount(broadcast: Pick<BroadcastRow, 'audience' | 'topicId'>): Promise<number> {
    if (!hasAudienceSources(broadcast.audience)) return 0

    return this.audience.count(broadcast.audience, broadcast.topicId)
  }

  /** Time of the last test send that reached the provider. */
  async lastTest(broadcastId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ at: auditLogs.createdAt })
      .from(auditLogs)
      .where(
        and(
          this.scope.eq(auditLogs.organizationId),
          eq(auditLogs.entityType, 'broadcast'),
          eq(auditLogs.entityId, broadcastId),
          eq(auditLogs.action, TEST_SENT_ACTION)
        )
      )
      .orderBy(desc(auditLogs.id))
      .limit(1)

    return row?.at ?? null
  }

  private audienceItem(broadcast: BroadcastRow, recipients: number): ChecklistItem {
    if (!hasAudienceSources(broadcast.audience))
      return item('audience', 'Audience', 'blocker', 'Choose at least one list or segment.')

    if (!recipients)
      return item(
        'audience',
        'Audience',
        'blocker',
        'No active, subscribed contacts match this audience.'
      )

    return item('audience', 'Audience', 'ok', `≈ ${plural(recipients, 'recipient')}`)
  }

  /** The sender must be set and, on the shared SES account, one of the organization's identities. */
  private async senderItem(broadcast: BroadcastRow): Promise<ChecklistItem> {
    const from = BroadcastContent.sender(broadcast)

    if (!from) return item('sender', 'Sender', 'blocker', 'Add a sender email address.')

    const label = broadcast.fromName
      ? `${broadcast.fromName} <${broadcast.fromEmail}>`
      : (broadcast.fromEmail ?? from)

    try {
      const verdict = await this.senders.check(from)

      if (!verdict.allowed) return item('sender', 'Sender', 'blocker', verdict.reason)
    } catch (error) {
      const reason = error instanceof DomainError ? error.message : 'the provider did not answer'

      return item('sender', 'Sender', 'warning', `${label} could not be verified: ${reason}`)
    }

    return item('sender', 'Sender', 'ok', label)
  }

  /** CAN-SPAM: the postal address must be set and printed by the template. */
  private addressItem(address: string, template: TemplateCheck | null): ChecklistItem {
    if (!address)
      return item(
        'address',
        'Postal address',
        'warning',
        'Add your postal address in Settings → General (required by CAN-SPAM).'
      )

    if (template && !template.error && !template.hasCompanyAddress)
      return item(
        'address',
        'Postal address',
        'warning',
        'The template does not print {{ company.address }}: make sure your postal address appears in the footer (required by CAN-SPAM).'
      )

    return item('address', 'Postal address', 'ok', address)
  }

  private sendingItem(sending: SendingSettings): ChecklistItem {
    if (sending.provider === 'ses') {
      if (!sending.ses.region)
        return item(
          'sending',
          'Sending provider',
          'blocker',
          'Choose the SES region in Settings → Sending.'
        )

      return item('sending', 'Sending provider', 'ok', `Amazon SES · ${sending.ses.region}`)
    }

    if (!sending.smtp.host)
      return item(
        'sending',
        'Sending provider',
        'blocker',
        'Enter the SMTP host in Settings → Sending.'
      )

    return item(
      'sending',
      'Sending provider',
      'ok',
      `SMTP · ${sending.smtp.host}:${sending.smtp.port}`
    )
  }

  private subjectItem(subject: string): ChecklistItem {
    if (!subject.trim()) return item('subject', 'Subject', 'blocker', 'Write a subject line.')

    try {
      this.renderer.assertLiquid(subject, 'subject')
    } catch (error) {
      return item(
        'subject',
        'Subject',
        'blocker',
        error instanceof DomainError ? error.message : 'The subject has invalid variables.'
      )
    }

    return item('subject', 'Subject', 'ok', subject)
  }

  private templateItem(template: TemplateCheck | null): ChecklistItem {
    if (!template) return item('template', 'Content', 'blocker', 'Choose a template.')

    if (template.error) return item('template', 'Content', 'blocker', template.error)

    if (template.transactional)
      return item('template', 'Content', 'warning', `${template.name} is a transactional template.`)

    return item('template', 'Content', 'ok', template.name ?? 'Template')
  }

  private unsubscribeItem(template: TemplateCheck | null): ChecklistItem {
    if (!template || template.error)
      return item('unsubscribe', 'Unsubscribe link', 'blocker', 'Needs a template that compiles.')

    if (!template.hasUnsubscribeLink) {
      return item(
        'unsubscribe',
        'Unsubscribe link',
        'blocker',
        'Add {{ unsubscribe_url }} or {{ preferences_url }} to the template footer.'
      )
    }

    return item(
      'unsubscribe',
      'Unsubscribe link',
      'ok',
      'One-click unsubscribe headers are added automatically.'
    )
  }

  private capacityItem(capacity: number, recipients: number): ChecklistItem {
    if (!Number.isFinite(capacity))
      return item('capacity', 'Send limit', 'ok', 'No sending limit configured.')

    if (capacity >= recipients)
      return item(
        'capacity',
        'Send limit',
        'ok',
        `${plural(capacity, 'email')} left in your limits.`
      )

    return item(
      'capacity',
      'Send limit',
      'warning',
      `Only ${plural(capacity, 'email')} left in your limits. The rest go out as capacity frees up.`
    )
  }

  private async checkTemplate(templateId: string | null): Promise<TemplateCheck | null> {
    if (!templateId) return null
    let template

    try {
      template = await this.templates.findOrFail(templateId)
    } catch {
      return null
    }

    const base = { name: template.name, transactional: template.kind === 'transactional' }

    try {
      const html = await this.templates.compiledHtml(template)
      this.renderer.assertLiquid(html, 'content')

      const { hasUnsubscribeLink, hasCompanyAddress } = this.renderer.inspect(html)

      return { ...base, error: null, hasUnsubscribeLink, hasCompanyAddress }
    } catch (error) {
      return {
        ...base,
        error: error instanceof DomainError ? error.message : 'The template could not be compiled.',
        hasUnsubscribeLink: false,
        hasCompanyAddress: false
      }
    }
  }
}
