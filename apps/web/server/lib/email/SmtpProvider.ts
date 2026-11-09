import nodemailer from 'nodemailer'
import type { SendMailOptions, Transporter } from 'nodemailer'
import type { SendingSettings } from '../../../shared/types/domain'
import { NodemailerProvider, formatSesTagHeader } from './NodemailerProvider'
import type { MessageHeaders, OutboundEmail } from './types'

/**
 * Any SMTP server. With `sesHeaders` enabled it targets the SES SMTP interface
 * and adds the configuration-set / message-tag headers used for event correlation.
 */
export class SmtpProvider extends NodemailerProvider {
  readonly id = 'smtp'
  protected readonly transporter: Transporter

  constructor(private readonly config: SendingSettings['smtp']) {
    super()
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
      pool: true,
      maxConnections: 5
    })
  }

  protected override extraOptions(email: OutboundEmail): Partial<SendMailOptions> {
    if (!this.config.sesHeaders) return {}
    const headers: MessageHeaders = { ...email.headers }

    if (this.config.configurationSet)
      headers['X-SES-CONFIGURATION-SET'] = this.config.configurationSet

    if (email.tags && Object.keys(email.tags).length)
      headers['X-SES-MESSAGE-TAGS'] = formatSesTagHeader(email.tags)

    return { headers }
  }

  /** SES SMTP answers `250 Ok <ses-message-id>`; other servers fall back to the Message-ID header. */
  protected extractMessageId(info: { response?: string; messageId?: string }) {
    const match = info.response?.match(/^250 Ok (\S+)/i)

    return match?.[1] ?? info.messageId?.replace(/^<|>$/g, '') ?? ''
  }
}
