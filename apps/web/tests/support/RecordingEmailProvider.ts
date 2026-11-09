import { randomUUID } from 'node:crypto'
import type {
  EmailProvider,
  OutboundEmail,
  ProviderQuota,
  SendResult
} from '../../server/lib/email/types'

/** Mail transport fake: accepts every email and keeps it for assertions. */
export class RecordingEmailProvider implements EmailProvider {
  readonly id = 'recording'
  readonly sent: OutboundEmail[] = []

  async send(email: OutboundEmail): Promise<SendResult> {
    this.sent.push(email)

    return { providerMessageId: `test-${randomUUID()}` }
  }

  async verify(): Promise<void> {}

  async getQuota(): Promise<ProviderQuota | null> {
    return null
  }

  /** Emails handed to the transport for one recipient, oldest first. */
  to(address: string): OutboundEmail[] {
    return this.sent.filter((email) => email.to === address)
  }

  /** The only email sent to `address` (fails the test when there is none or several). */
  only(address: string): OutboundEmail {
    const emails = this.to(address)

    if (emails.length !== 1)
      throw new Error(`Expected one email to ${address}, found ${emails.length}`)

    return emails[0]!
  }
}
