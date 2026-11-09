import type { broadcasts } from '../../db/schema'
import type { JsonObject, UtmSettings } from '../../../shared/types/domain'
import { campaignSlug } from '../../../shared/schemas/broadcasts'
import type { LinkBuilder } from '../security/LinkBuilder'
import type { SettingsService } from '../settings/SettingsService'
import type {
  ContactVariables,
  PreparedEmail,
  RenderVariables,
  TemplateRenderer
} from '../templates/TemplateRenderer'
import { SAMPLE_CONTACT } from '../templates/TemplatePreviewer'
import { formatMailbox } from '../email/mailbox'

type BroadcastContentSource = Pick<
  typeof broadcasts.$inferSelect,
  'id' | 'name' | 'subject' | 'preheader' | 'utm' | 'fromName' | 'fromEmail'
>

/** Contact columns needed to personalise an email. */
export interface RecipientContact {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  attributes: JsonObject | null
}

export interface RecipientLinks {
  unsubscribe_url: string
  preferences_url: string
  web_url: string
}

export const DEFAULT_UTM_SOURCE = 'newsletter'
export const DEFAULT_UTM_MEDIUM = 'email'

/**
 * Turns a broadcast into renderable content: the effective UTM settings, the
 * prepared (parsed once) template, recipient variables and signed links.
 * Shared by the batch sender, test sends and the composer preview.
 * Bound to one organization through its LinkBuilder (links carry the `o`
 * claim) and SettingsService (company details).
 */
export class BroadcastContent {
  constructor(
    private readonly renderer: TemplateRenderer,
    private readonly links: LinkBuilder,
    private readonly settings: SettingsService
  ) {}

  /** UTM parameters with defaults filled in (campaign defaults to the slugged name). */
  static utm(broadcast: Pick<BroadcastContentSource, 'utm' | 'name'>): UtmSettings {
    const utm = broadcast.utm ?? { enabled: false }

    return {
      enabled: utm.enabled,
      source: utm.source || DEFAULT_UTM_SOURCE,
      medium: utm.medium || DEFAULT_UTM_MEDIUM,
      campaign: utm.campaign || campaignSlug(broadcast.name)
    }
  }

  /** `"Acme" <hello@acme.com>`; null when no sender address is set. */
  static sender(broadcast: Pick<BroadcastContentSource, 'fromName' | 'fromEmail'>): string | null {
    if (!broadcast.fromEmail) return null

    return formatMailbox(broadcast.fromName ?? '', broadcast.fromEmail)
  }

  /** RFC 2919 List-Id: stable per broadcast, scoped to the sender domain. */
  static listId(broadcast: Pick<BroadcastContentSource, 'id' | 'fromEmail'>): string {
    const domain = broadcast.fromEmail?.split('@')[1]?.toLowerCase() || 'localhost'

    return `<${broadcast.id}.${domain}>`
  }

  static contactVariables(contact: RecipientContact): ContactVariables {
    return {
      id: contact.id,
      email: contact.email,
      first_name: contact.firstName,
      last_name: contact.lastName,
      attributes: contact.attributes ?? {}
    }
  }

  async prepare(broadcast: BroadcastContentSource, html: string): Promise<PreparedEmail> {
    return this.renderer.prepare({
      subject: broadcast.subject,
      html,
      preheader: broadcast.preheader,
      utm: BroadcastContent.utm(broadcast),
      ownUrlPrefix: this.links.baseUrl
    })
  }

  async company(): Promise<{ name: string; address: string }> {
    const general = await this.settings.get('general')

    return { name: general.companyName, address: general.companyAddress }
  }

  /** Signed recipient links (unsubscribe is RFC 8058 one-click capable). */
  async recipientLinks(contactId: string, messageId: string): Promise<RecipientLinks> {
    const claims = { c: contactId, m: messageId }

    const [unsubscribe, preferences, web] = await Promise.all([
      this.links.unsubscribeUrl(claims),
      this.links.preferencesUrl(claims),
      this.links.webUrl(claims)
    ])

    return { unsubscribe_url: unsubscribe, preferences_url: preferences, web_url: web }
  }

  /** Inert links used for previews and tests rendered with sample data. */
  placeholderLinks(): RecipientLinks {
    const base = this.links.baseUrl

    return {
      unsubscribe_url: `${base}/u/preview`,
      preferences_url: `${base}/preferences/preview`,
      web_url: `${base}/view/preview`
    }
  }

  sampleContact(email?: string): ContactVariables {
    const contact: ContactVariables = { ...SAMPLE_CONTACT }

    if (email) contact.email = email

    return contact
  }

  variables(
    contact: ContactVariables,
    links: RecipientLinks,
    company: { name: string; address: string }
  ): RenderVariables {
    return { contact, company, data: {}, ...links }
  }
}
