import type { AuditLogger } from '../audit/AuditLogger'
import type { Actor } from '../core/actor'
import { InvalidStateError, ProviderError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import type { ProviderRegistry } from '../email/ProviderRegistry'
import { SesProvider } from '../email/SesProvider'
import type { EmailProvider, ProviderQuota } from '../email/types'
import type { SystemMail } from '../organizations/SystemMail'
import type { SettingsInput, SettingsService } from './SettingsService'

export interface ConnectionResult {
  ok: true
  provider: string
  message: string
  durationMs: number
}

export interface QuotaReport {
  provider: 'ses' | 'smtp'
  /** Present when SES API credentials are available (SES provider, or SES SMTP with API keys). */
  quota: ProviderQuota | null
  error: string | null
}

export interface TestEmailResult {
  messageId: string
  providerMessageId: string
  to: string
  from: string
}

const VERIFY_TIMEOUT_MS = 15_000

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ProviderError(
            `${what} timed out after ${Math.round(ms / 1000)}s. Check the host, port and firewall.`,
            false
          )
        ),
      ms
    )
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Connection tests and diagnostics behind Settings → Sending / Storage:
 * verify (saved or unsaved) provider settings, read the SES quota and send a test email.
 */
export class SettingsDiagnostics {
  constructor(
    protected readonly scope: TenantScope,
    private readonly settings: SettingsService,
    private readonly providers: ProviderRegistry,
    private readonly systemMail: SystemMail,
    private readonly audit: AuditLogger
  ) {}

  /** Verifies the saved email provider, or `draft` (an unsaved sending section; masked secrets keep their stored value). */
  async verifySending(draft?: SettingsInput<'sending'>): Promise<ConnectionResult> {
    const started = Date.now()

    const sending =
      draft === undefined
        ? await this.settings.get('sending')
        : await this.settings.preview('sending', draft)

    const temporary = draft !== undefined

    const provider: EmailProvider = temporary
      ? await this.providers.buildEmail(sending)
      : await this.providers.email()

    const target =
      sending.provider === 'ses'
        ? `Amazon SES (${sending.ses.region})`
        : `${sending.smtp.host}:${sending.smtp.port}`

    try {
      await withTimeout(provider.verify(), VERIFY_TIMEOUT_MS, 'The connection test')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error'
      throw new ProviderError(`Could not connect to ${target}: ${reason}`, false)
    } finally {
      if (temporary) provider.close?.()
    }

    const message =
      sending.provider === 'ses'
        ? `Connected to Amazon SES in ${sending.ses.region}.`
        : `Connected to ${sending.smtp.host}:${sending.smtp.port}${sending.smtp.user ? ' and authenticated' : ''}.`

    return { ok: true, provider: sending.provider, message, durationMs: Date.now() - started }
  }

  /** Verifies the saved storage settings, or `draft`. Creates the bucket when it is missing. */
  async verifyStorage(draft?: SettingsInput<'storage'>): Promise<ConnectionResult> {
    const started = Date.now()

    const storage =
      draft === undefined
        ? await this.settings.get('storage')
        : await this.settings.preview('storage', draft)

    const provider =
      draft === undefined
        ? await this.providers.storage()
        : await this.providers.buildStorage(storage)

    await withTimeout(provider.verify(), VERIFY_TIMEOUT_MS, 'The storage check')
    const where = storage.endpoint ? new URL(storage.endpoint).host : `S3 (${storage.region})`

    return {
      ok: true,
      provider: provider.id,
      message: `Bucket "${storage.bucket}" is reachable on ${where}.`,
      durationMs: Date.now() - started
    }
  }

  /** SES account quota, when SES API credentials are available. Never throws: errors are reported inline. */
  async sendingQuota(): Promise<QuotaReport> {
    const sending = await this.settings.get('sending')
    let provider: EmailProvider | null = null
    let temporary = false

    if (sending.provider === 'ses') {
      provider = await this.providers.email()
    } else if (sending.ses.accessKeyId && sending.ses.secretAccessKey) {
      provider = new SesProvider(sending.ses)
      temporary = true
    }

    if (!provider) return { provider: sending.provider, quota: null, error: null }

    try {
      return {
        provider: sending.provider,
        quota: await withTimeout(provider.getQuota(), 10_000, 'The quota request'),
        error: null
      }
    } catch (error) {
      return {
        provider: sending.provider,
        quota: null,
        error: error instanceof Error ? error.message : 'Could not read the SES quota'
      }
    } finally {
      if (temporary) provider.close?.()
    }
  }

  /** Sends a small branded email through the saved provider, records it as a `system` message. */
  async sendTestEmail(to: string, actor: Actor): Promise<TestEmailResult> {
    const sending = await this.settings.get('sending')

    const providerLabel =
      sending.provider === 'ses'
        ? `Amazon SES (${sending.ses.region})`
        : `SMTP (${sending.smtp.host}:${sending.smtp.port})`

    const { messageId, from, outcome } = await this.systemMail.test(to, actor, providerLabel)

    await this.audit.log(actor, {
      action: 'settings.test_email_sent',
      entityType: 'settings',
      entityId: 'sending',
      summary: `Sent a test email to ${to}`,
      changes: { to, provider: sending.provider, status: outcome.status, messageId }
    })

    switch (outcome.status) {
      case 'sent':
        return { messageId, providerMessageId: outcome.providerMessageId, to, from }
      case 'suppressed':
        throw new InvalidStateError(
          `${to} is on the suppression list (${outcome.reason.replace(/_/g, ' ')}). Remove it in Settings → Suppressions to send a test.`
        )
      default:
        throw new ProviderError(`The provider rejected the test email: ${outcome.error}`, false)
    }
  }
}
