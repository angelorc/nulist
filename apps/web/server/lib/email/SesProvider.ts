import { GetAccountCommand, SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import nodemailer from 'nodemailer'
import type { SendMailOptions, Transporter } from 'nodemailer'
import type { SendingSettings } from '../../../shared/types/domain'
import { ProviderError } from '../core/errors'
import { NodemailerProvider, sanitizeTag, transportError } from './NodemailerProvider'
import type { OutboundEmail, ProviderQuota } from './types'

/** Amazon SES v2 API (raw MIME through nodemailer so we keep full header control). */
export class SesProvider extends NodemailerProvider {
  readonly id = 'ses'
  readonly client: SESv2Client
  protected readonly transporter: Transporter

  constructor(private readonly config: SendingSettings['ses']) {
    super()
    this.client = new SESv2Client({
      region: config.region,
      credentials: config.accessKeyId
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined
    })
    this.transporter = nodemailer.createTransport({
      SES: { sesClient: this.client, SendEmailCommand }
    })
  }

  protected override extraOptions(email: OutboundEmail): Partial<SendMailOptions> {
    return {
      ses: {
        ConfigurationSetName: this.config.configurationSet || undefined,
        EmailTags: Object.entries(email.tags ?? {}).map(([Name, Value]) => ({
          Name: sanitizeTag(Name),
          Value: sanitizeTag(Value)
        }))
      }
    }
  }

  protected extractMessageId(info: { response?: string; messageId?: string }) {
    return info.response ?? info.messageId ?? ''
  }

  override async verify(): Promise<void> {
    await this.getQuota()
  }

  override async getQuota(): Promise<ProviderQuota> {
    try {
      const account = await this.client.send(new GetAccountCommand({}))

      return {
        max24HourSend: account.SendQuota?.Max24HourSend ?? 0,
        maxSendRate: account.SendQuota?.MaxSendRate ?? 0,
        sentLast24Hours: account.SendQuota?.SentLast24Hours ?? 0,
        sendingEnabled: account.SendingEnabled ?? false,
        productionAccess: account.ProductionAccessEnabled ?? null
      }
    } catch (cause) {
      const error = transportError(cause)

      throw new ProviderError(error.message ?? 'Could not read the SES account', false, error.name)
    }
  }
}
