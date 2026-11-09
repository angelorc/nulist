import type { DnsRecord } from '../../../shared/schemas/domains'

export interface DnsPlanInput {
  domain: string
  /** SES Easy DKIM tokens (three per identity). */
  dkimTokens?: string[]
  /** Custom MAIL FROM (return-path) domain, a subdomain of `domain`. */
  mailFromDomain?: string | null
  /** SES region, used for the MAIL FROM feedback MX host. */
  region?: string | null
  /** Mail goes out through Amazon SES. */
  ses: boolean
}

export const SES_SPF_INCLUDE = 'amazonses.com'

/** Recommended starting DMARC policy: monitor first, tighten later. */
export function recommendedDmarc(domain: string): string {
  return `v=DMARC1; p=none; rua=mailto:dmarc-reports@${domain}`
}

/**
 * The set of DNS records a domain needs to send authenticated email.
 * Shared by the identity view (records to publish) and the DNS checks (expected values).
 */
export class DnsRecordPlan {
  constructor(readonly input: DnsPlanInput) {}

  get domain() {
    return this.input.domain
  }

  get mailFromDomain(): string | null {
    return this.input.mailFromDomain || null
  }

  get dkimTokens(): string[] {
    return this.input.dkimTokens ?? []
  }

  /** Easy DKIM CNAMEs (SES), one per token. */
  dkim(): DnsRecord[] {
    return this.dkimTokens.map((token) => ({
      type: 'CNAME',
      name: `${token}._domainkey.${this.domain}`,
      value: `${token}.dkim.amazonses.com`,
      purpose: 'dkim'
    }))
  }

  /** Generic DKIM key record used when the provider's selector is unknown. */
  genericDkim(selector = '<selector>'): DnsRecord {
    return {
      type: 'TXT',
      name: `${selector}._domainkey.${this.domain}`,
      value: 'v=DKIM1; k=rsa; p=<public key from your provider>',
      purpose: 'dkim',
      placeholder: true
    }
  }

  /** SPF lives on the MAIL FROM domain when one is set, otherwise on the domain itself. */
  spf(): DnsRecord {
    return this.input.ses
      ? {
          type: 'TXT',
          name: this.mailFromDomain ?? this.domain,
          value: `v=spf1 include:${SES_SPF_INCLUDE} ~all`,
          purpose: 'spf'
        }
      : {
          type: 'TXT',
          name: this.mailFromDomain ?? this.domain,
          value: 'v=spf1 a mx include:<your provider> ~all',
          purpose: 'spf',
          placeholder: true
        }
  }

  /** Feedback MX for a custom MAIL FROM domain (bounces and complaints go back to SES). */
  mailFromMx(): DnsRecord | null {
    if (!this.mailFromDomain) return null

    if (this.input.ses && this.input.region) {
      return {
        type: 'MX',
        name: this.mailFromDomain,
        value: `feedback-smtp.${this.input.region}.amazonses.com`,
        priority: 10,
        purpose: 'mail_from'
      }
    }

    return {
      type: 'MX',
      name: this.mailFromDomain,
      value: '<bounce host from your provider>',
      priority: 10,
      purpose: 'mail_from',
      placeholder: true
    }
  }

  dmarc(): DnsRecord {
    return {
      type: 'TXT',
      name: `_dmarc.${this.domain}`,
      value: recommendedDmarc(this.domain),
      purpose: 'dmarc'
    }
  }

  /** Every record to publish, in the order they are usually added. */
  records(): DnsRecord[] {
    const records: DnsRecord[] = [...this.dkim()]
    const mx = this.mailFromMx()

    if (mx) records.push(mx)

    if (this.mailFromDomain || !this.input.ses) records.push(this.spf())
    records.push(this.dmarc())

    return records
  }
}
