import type { SendMailOptions, Transporter } from 'nodemailer'
import { z } from 'zod'
import { ProviderError } from '../core/errors'
import type { EmailProvider, OutboundEmail, ProviderQuota, SendResult } from './types'

/** The fields we read from a transport or AWS SDK error; anything unexpected is dropped. */
const transportErrorSchema = z
  .object({
    name: z.string().optional().catch(undefined),
    message: z.string().optional().catch(undefined),
    code: z.string().optional().catch(undefined),
    responseCode: z.number().optional().catch(undefined),
    $metadata: z
      .object({ httpStatusCode: z.number().optional().catch(undefined) })
      .optional()
      .catch(undefined)
  })
  .catch({})

export type TransportError = z.output<typeof transportErrorSchema>

/** Reads a thrown transport error (nodemailer, SMTP, AWS SDK) without trusting its shape. */
export function transportError(cause: unknown): TransportError {
  return transportErrorSchema.parse(cause)
}

/** Template-method base class: subclasses supply the transporter and provider specifics. */
export abstract class NodemailerProvider implements EmailProvider {
  abstract readonly id: string
  protected abstract readonly transporter: Transporter

  /** Provider specific options merged into the nodemailer message. */
  protected extraOptions(_email: OutboundEmail): Partial<SendMailOptions> {
    return {}
  }

  protected abstract extractMessageId(info: { messageId?: string; response?: string }): string

  /** Whether a transport error should be retried (throttling, transient network/SMTP 4xx). */
  protected isRetryable(error: TransportError): boolean {
    if (error.responseCode && error.responseCode >= 400 && error.responseCode < 500) return true

    if (
      ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET', 'ECONNECTION', 'EAI_AGAIN'].includes(
        error.code ?? ''
      )
    )
      return true

    if (
      [
        'TooManyRequestsException',
        'ThrottlingException',
        'LimitExceededException',
        'InternalFailure',
        'ServiceUnavailable'
      ].includes(error.name ?? '')
    )
      return true
    const status = error.$metadata?.httpStatusCode

    return !!status && (status === 429 || status >= 500)
  }

  async send(email: OutboundEmail): Promise<SendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: email.from,
        to: email.to,
        replyTo: email.replyTo || undefined,
        subject: email.subject,
        html: email.html,
        text: email.text || undefined,
        headers: email.headers,
        ...this.extraOptions(email)
      })

      return { providerMessageId: this.extractMessageId(info) }
    } catch (cause) {
      const error = transportError(cause)

      throw new ProviderError(
        error.message ?? 'Sending failed',
        this.isRetryable(error),
        error.name === 'Error' ? error.code : error.name
      )
    }
  }

  async verify(): Promise<void> {
    try {
      await this.transporter.verify()
    } catch (cause) {
      throw new ProviderError(transportError(cause).message ?? 'Verification failed', false)
    }
  }

  async getQuota(): Promise<ProviderQuota | null> {
    return null
  }

  close() {
    this.transporter.close?.()
  }
}

/** Formats tags as `X-SES-MESSAGE-TAGS: a=1, b=2`, dropping invalid characters. */
export function formatSesTagHeader(tags: Record<string, string>): string {
  return Object.entries(tags)
    .map(([k, v]) => `${sanitizeTag(k)}=${sanitizeTag(v)}`)
    .join(', ')
}

export function sanitizeTag(value: string): string {
  return value.replace(/[^\w-]/g, '_').slice(0, 256)
}
