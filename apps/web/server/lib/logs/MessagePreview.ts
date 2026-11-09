import type { EmailLogDetail } from '../../../shared/types/logs'
import type { SettingsService } from '../settings/SettingsService'
import { htmlToText } from '../templates/TemplateRenderer'
import type { TemplateRenderer } from '../templates/TemplateRenderer'
import type { TenantScope } from '../core/TenantScope'

/**
 * Makes a logged email viewable. Broadcast messages do not store their HTML:
 * the broadcast snapshot still holds Liquid tags, so it is rendered for the
 * message's contact (recipient links are replaced by inert `#` targets).
 * Falls back to the raw snapshot when it cannot be rendered.
 */
export class MessagePreview {
  constructor(
    protected readonly scope: TenantScope,
    private readonly renderer: TemplateRenderer,
    private readonly settings: SettingsService
  ) {}

  async apply(detail: EmailLogDetail): Promise<EmailLogDetail> {
    if (detail.htmlSource !== 'broadcast' || !detail.html) {
      return { ...detail, text: detail.text ?? (detail.html ? htmlToText(detail.html) : null) }
    }

    try {
      const general = await this.settings.get('general')
      const prepared = await this.renderer.prepare({ subject: detail.subject, html: detail.html })

      const rendered = await prepared.render({
        contact: detail.contact
          ? {
              id: detail.contact.id,
              email: detail.contact.email,
              first_name: detail.contact.firstName,
              last_name: detail.contact.lastName,
              attributes: detail.contact.attributes
            }
          : { email: detail.toEmail },
        company: { name: general.companyName, address: general.companyAddress },
        unsubscribe_url: '#',
        preferences_url: '#',
        web_url: '#'
      })

      return { ...detail, html: rendered.html, text: detail.text ?? rendered.text }
    } catch {
      return { ...detail, text: detail.text ?? htmlToText(detail.html) }
    }
  }
}
