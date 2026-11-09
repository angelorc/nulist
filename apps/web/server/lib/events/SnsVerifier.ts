import SnsPayloadValidator from 'sns-payload-validator'
import { z } from 'zod'
import { DomainError } from '../core/errors'

export interface SnsEnvelope {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation'
  MessageId: string
  TopicArn: string
  Message: string
  Timestamp: string
  SubscribeURL?: string
  Token?: string
  Subject?: string
}

/** Verifies the authenticity of an SNS HTTP(S) delivery. */
export interface SnsVerifier {
  verify(body: string): Promise<SnsEnvelope>
}

/** The request is not a genuine SNS delivery for an allowed topic. */
export class SnsVerificationError extends DomainError {
  constructor(message: string) {
    super(message, 403, 'invalid_sns_message')
  }
}

const envelopeSchema = z.looseObject({
  Type: z.enum(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']),
  MessageId: z.string().min(1).max(200),
  TopicArn: z.string().min(1).max(512),
  Message: z.string(),
  Timestamp: z.string(),
  SignatureVersion: z.enum(['1', '2']),
  Signature: z.string().min(1),
  SigningCertURL: z.string().min(1),
  SubscribeURL: z.string().optional(),
  UnsubscribeURL: z.string().optional(),
  Token: z.string().optional(),
  Subject: z.string().optional()
})

/**
 * SNS signature verification backed by `sns-payload-validator`: checks the
 * SigningCertURL host (sns.<region>.amazonaws.com), downloads and caches the
 * certificate and verifies SignatureVersion 1 (SHA1) and 2 (SHA256) signatures.
 * On top of that, only topics in the allow-list are accepted. An empty list
 * accepts nothing: anyone can create an SNS topic and sign deliveries for it.
 */
export class SnsPayloadVerifier implements SnsVerifier {
  private readonly validator = new SnsPayloadValidator({ useCache: true, maxCerts: 100 })

  constructor(protected readonly allowedTopicArns: string[]) {}

  async verify(body: string): Promise<SnsEnvelope> {
    const envelope = this.parse(body)

    // Cheap check first: never fetch certificates for topics we would reject anyway.
    if (!this.isTopicAllowed(envelope.TopicArn)) {
      if (!this.allowedTopicArns.length)
        console.warn(
          `[sns] rejected a delivery from ${envelope.TopicArn}: set NUXT_SNS_TOPIC_ARNS to the SES event topic(s)`
        )
      throw new SnsVerificationError('SNS topic is not allowed')
    }

    try {
      await this.validator.validate({ ...envelope })
    } catch {
      throw new SnsVerificationError('Invalid SNS signature')
    }

    return envelope
  }

  /** Fails closed: an empty allow-list accepts no topic. */
  isTopicAllowed(topicArn: string): boolean {
    return this.allowedTopicArns.includes(topicArn)
  }

  private parse(body: string): SnsEnvelope & z.infer<typeof envelopeSchema> {
    let json: unknown

    try {
      json = JSON.parse(body)
    } catch {
      throw new SnsVerificationError('Body is not a valid SNS message')
    }

    const result = envelopeSchema.safeParse(json)

    if (!result.success) throw new SnsVerificationError('Body is not a valid SNS message')

    return result.data
  }
}
