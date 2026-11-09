import { and, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { broadcasts, contacts as contactsTable, messages } from '../../db/schema'
import type { WebViewMeta } from '../../../shared/schemas/public'
import type { ContactService } from '../contacts/ContactService'
import { NotFoundError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import type { LinkBuilder } from '../security/LinkBuilder'
import type { RecipientClaims, TokenService } from '../security/TokenService'
import type { SettingsService } from '../settings/SettingsService'
import type { RenderVariables, TemplateRenderer } from '../templates/TemplateRenderer'
import { RecipientTokens } from './RecipientTokens'

export interface WebViewDocument {
  subject: string
  html: string
}

type MessageRow = typeof messages.$inferSelect

/**
 * "View in browser" inside one organization: renders the email a recipient
 * received. Broadcasts are re-rendered from the broadcast's HTML snapshot with
 * that recipient's variables; transactional and system emails use the stored
 * HTML. Messages of other organizations are "not found".
 */
export class WebViewRenderer {
  private readonly recipients: RecipientTokens

  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly tokens: TokenService,
    private readonly renderer: TemplateRenderer,
    private readonly links: LinkBuilder,
    private readonly settings: SettingsService,
    private readonly contacts: ContactService
  ) {
    this.recipients = new RecipientTokens(scope, tokens)
  }

  async render(token: string): Promise<WebViewDocument> {
    const { claims, message } = await this.load(token)

    const document = message.broadcastId
      ? await this.renderBroadcast(message, message.broadcastId, claims)
      : null

    const resolved =
      document ?? (message.html ? { subject: message.subject, html: message.html } : null)

    if (!resolved) throw new NotFoundError('Email')

    return {
      subject: resolved.subject,
      html: WebViewRenderer.decorate(resolved.html, resolved.subject)
    }
  }

  async meta(token: string): Promise<WebViewMeta> {
    const { claims, message } = await this.load(token)

    return {
      subject: message.subject,
      from:
        message.fromEmail.replace(/\s*<[^>]*>\s*$/, '').replace(/^"|"$/g, '') || message.fromEmail,
      sentAt: (message.sentAt ?? message.createdAt).toISOString(),
      // The organization claim (`o`) is added by the scoped LinkBuilder.
      preferencesUrl:
        message.kind === 'broadcast'
          ? await this.links.preferencesUrl({ c: claims.c, m: message.id })
          : null
    }
  }

  private async load(token: string): Promise<{ claims: RecipientClaims; message: MessageRow }> {
    const claims = await this.recipients.verify('web', token)

    if (!claims.m) throw new NotFoundError('Email')

    const [message] = await this.db
      .select()
      .from(messages)
      .where(
        and(
          this.scope.eq(messages.organizationId),
          eq(messages.id, claims.m),
          eq(messages.contactId, claims.c)
        )
      )

    if (!message) throw new NotFoundError('Email')

    return { claims, message }
  }

  private async renderBroadcast(
    message: MessageRow,
    broadcastId: string,
    claims: RecipientClaims
  ): Promise<WebViewDocument | null> {
    const [broadcast] = await this.db
      .select({
        subject: broadcasts.subject,
        preheader: broadcasts.preheader,
        htmlSnapshot: broadcasts.htmlSnapshot,
        utm: broadcasts.utm
      })
      .from(broadcasts)
      .where(and(this.scope.eq(broadcasts.organizationId), eq(broadcasts.id, broadcastId)))

    if (!broadcast?.htmlSnapshot) return null

    const [contact] = await this.db
      .select()
      .from(contactsTable)
      .where(and(this.scope.eq(contactsTable.organizationId), eq(contactsTable.id, claims.c)))

    if (!contact) return null
    const general = await this.settings.get('general')
    // Regenerated links carry this organization (`o`) through the scoped LinkBuilder.
    const recipient = { c: contact.id, m: message.id }

    const variables: RenderVariables = {
      contact: this.contacts.toTemplateVariables(contact),
      unsubscribe_url: await this.links.unsubscribeUrl(recipient),
      preferences_url: await this.links.preferencesUrl(recipient),
      web_url: await this.links.webUrl(recipient),
      company: { name: general.companyName || general.appName, address: general.companyAddress },
      // Variables recorded at send time win, so the page matches the email.
      ...message.variables
    }

    const prepared = await this.renderer.prepare({
      subject: broadcast.subject || message.subject,
      html: broadcast.htmlSnapshot,
      preheader: broadcast.preheader,
      utm: broadcast.utm,
      ownUrlPrefix: this.links.baseUrl
    })

    const rendered = await prepared.render(variables)

    return { subject: rendered.subject, html: rendered.html }
  }

  /** Links open outside the frame, the page is not indexed and leaks no referrer (the URL is a credential). */
  static decorate(html: string, subject: string): string {
    const head = [
      '<meta charset="utf-8">',
      '<meta name="robots" content="noindex, nofollow">',
      '<meta name="referrer" content="no-referrer">',
      '<base target="_blank">',
      `<title>${escapeHtml(subject)}</title>`
    ].join('')

    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => match + head)

    if (/<html[^>]*>/i.test(html))
      return html.replace(/<html[^>]*>/i, (match) => `${match}<head>${head}</head>`)

    return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
