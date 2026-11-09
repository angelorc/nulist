/** Extra MIME headers, by header name. */
export interface MessageHeaders {
  [name: string]: string
}

/** Correlation tags (SES message tags), by tag name. Values: [A-Za-z0-9_-] only. */
export interface MessageTags {
  [name: string]: string
}

/** A fully rendered email ready to be handed to a provider. */
export interface OutboundEmail {
  /** RFC 5322 address, e.g. `Acme <hello@acme.com>`. */
  from: string
  to: string
  replyTo?: string | null
  subject: string
  html: string
  text?: string | null
  headers?: MessageHeaders
  tags?: MessageTags
}

export interface SendResult {
  providerMessageId: string
}

export interface ProviderQuota {
  max24HourSend: number
  maxSendRate: number
  sentLast24Hours: number
  sendingEnabled: boolean
  productionAccess: boolean | null
}

/** Strategy interface implemented by every outbound email transport. */
export interface EmailProvider {
  readonly id: string
  send(email: OutboundEmail): Promise<SendResult>
  /** Throws a ProviderError when the configuration is unusable. */
  verify(): Promise<void>
  /** Account-level sending quota when the provider exposes one. */
  getQuota(): Promise<ProviderQuota | null>
  close?(): void
}
