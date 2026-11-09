import { z } from 'zod'

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
const HOSTNAME_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/

/** A bare domain name. Pasted URLs (`https://example.com/`) and trailing dots are normalised. */
export const domainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .overwrite((value) =>
    value
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/[/?#].*$/, '')
      .replace(/\.+$/, '')
  )
  .regex(HOSTNAME_RE, 'Enter a domain such as example.com')

export const MX_FAILURE_BEHAVIORS = [
  {
    value: 'USE_DEFAULT_VALUE',
    label: 'Fall back to amazonses.com',
    description: 'Keep sending with the default MAIL FROM domain if the MX record is missing.'
  },
  {
    value: 'REJECT_MESSAGE',
    label: 'Reject the message',
    description: 'Stop sending until the MX record is fixed.'
  }
] as const

export type MxFailureBehavior = (typeof MX_FAILURE_BEHAVIORS)[number]['value']

export const addDomainSchema = z.object({
  domain: domainNameSchema
})

export type AddDomainInput = z.infer<typeof addDomainSchema>

export const mailFromSchema = z.object({
  /** Full MAIL FROM domain (a subdomain of the identity), or empty to use the SES default. */
  mailFromDomain: z.union([z.literal(''), domainNameSchema]),
  behaviorOnMxFailure: z.enum(['USE_DEFAULT_VALUE', 'REJECT_MESSAGE']).default('USE_DEFAULT_VALUE')
})

export type MailFromInput = z.infer<typeof mailFromSchema>

/** UI form for MAIL FROM: only the subdomain label(s) in front of the identity domain. */
export const mailFromFormSchema = z.object({
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^$|^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/,
      'Use letters, numbers and hyphens, such as mail or bounce'
    ),
  behaviorOnMxFailure: z.enum(['USE_DEFAULT_VALUE', 'REJECT_MESSAGE'])
})

export type MailFromFormInput = z.infer<typeof mailFromFormSchema>

export const domainCheckSchema = z.object({
  domain: domainNameSchema,
  dkimTokens: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[a-z0-9]{8,64}$/i, 'Invalid DKIM token')
    )
    .max(10)
    .optional(),
  mailFromDomain: z.union([z.literal(''), domainNameSchema]).optional()
})

export type DomainCheckInput = z.infer<typeof domainCheckSchema>

export const domainParamsSchema = z.object({
  domain: domainNameSchema
})

/** Settings → Sending: "Send test email". */
export const testEmailSchema = z.object({
  to: z.email('Enter a valid email address')
})

export type TestEmailInput = z.infer<typeof testEmailSchema>

/** Response of POST /api/settings/sending/test-email. */
export interface TestEmailResult {
  messageId: string
  providerMessageId: string
  to: string
  from: string
}

/** Response of POST /api/settings/{sending|storage}/verify. */
export interface ConnectionTestResult {
  ok: true
  provider: string
  message: string
  durationMs: number
}

/** Amazon SES account quota for the configured region. */
export interface SendingQuota {
  max24HourSend: number
  maxSendRate: number
  sentLast24Hours: number
  sendingEnabled: boolean
  productionAccess: boolean | null
}

/** Response of GET /api/settings/sending/quota (errors are reported, not thrown). */
export interface SendingQuotaReport {
  provider: 'ses' | 'smtp'
  /** Present when SES API credentials are available. */
  quota: SendingQuota | null
  error: string | null
}

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------
export type DnsRecordType = 'CNAME' | 'TXT' | 'MX'

export type DnsRecordPurpose = 'dkim' | 'spf' | 'dmarc' | 'mail_from'

/** A DNS record the customer has to publish. */
export interface DnsRecord {
  type: DnsRecordType
  name: string
  value: string
  priority?: number
  purpose: DnsRecordPurpose
  /** Value contains a provider-specific placeholder and cannot be copied verbatim. */
  placeholder?: boolean
}

export type DnsCheckStatus = 'pass' | 'warn' | 'fail'

export type DnsCheckKind = 'spf' | 'dkim' | 'dmarc' | 'mx'

export interface DnsCheck {
  id: string
  kind: DnsCheckKind
  label: string
  status: DnsCheckStatus
  /** The record we expect to find. */
  record: DnsRecord
  /** What the live DNS lookup returned. */
  found: string[]
  /** Plain-language guidance for this result. */
  help: string
}

export type DmarcPolicy = 'none' | 'quarantine' | 'reject'

export interface DomainCheckResult {
  domain: string
  checkedAt: string
  /** Whether the checks assumed Amazon SES (SPF include, DKIM CNAMEs, feedback MX). */
  ses: boolean
  dmarcPolicy: DmarcPolicy | null
  checks: DnsCheck[]
  summary: Record<DnsCheckStatus, number>
}

export type IdentityStatus = 'verified' | 'pending' | 'failed' | 'temporary_failure' | 'not_started'

export interface DomainIdentity {
  name: string
  type: 'domain' | 'email'
  status: IdentityStatus
  sendingEnabled: boolean
  dkim: {
    status: IdentityStatus
    signingEnabled: boolean
    tokens: string[]
  }
  mailFrom: {
    domain: string | null
    status: IdentityStatus | null
    behaviorOnMxFailure: MxFailureBehavior
  }
  /** Records to publish for this identity (DKIM, MAIL FROM, DMARC). */
  records: DnsRecord[]
}

export interface DomainOverview {
  /** SES API credentials are available: identities can be managed from mlist. */
  managed: boolean
  /** Mail goes out through Amazon SES (API or SMTP interface). */
  viaSes: boolean
  region: string | null
  identities: DomainIdentity[]
}
