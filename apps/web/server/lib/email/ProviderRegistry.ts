import type { SendingSettings, StorageSettings } from '../../../shared/types/domain'
import { OutboundTargetPolicy } from '../security/OutboundTargetPolicy'
import type { SettingsService } from '../settings/SettingsService'
import type { StorageProvider } from '../storage/StorageProvider'
import { S3StorageProvider } from '../storage/S3StorageProvider'
import { SesProvider } from './SesProvider'
import { SmtpProvider } from './SmtpProvider'
import type { EmailProvider } from './types'

export interface ProviderOverrides {
  email?: EmailProvider
  storage?: StorageProvider
}

interface Cached<T> {
  fingerprint: string
  provider: T
}

/**
 * Factory + cache for the providers configured in one organization's settings. A provider is
 * rebuilt whenever its settings fingerprint changes, which also works across
 * processes/bundles (settings are re-read every few seconds). Organization
 * hosts (SMTP, S3 endpoint) go through the outbound policy: never the
 * instance's internal network.
 */
export class ProviderRegistry {
  private emailCache?: Cached<EmailProvider>
  private storageCache?: Cached<StorageProvider>

  constructor(
    private readonly settings: SettingsService,
    private readonly targets: OutboundTargetPolicy,
    private readonly overrides: ProviderOverrides = {}
  ) {}

  /** A new (uncached) email provider for `sending`, e.g. unsaved settings under test. */
  async buildEmail(sending: SendingSettings): Promise<EmailProvider> {
    if (sending.provider === 'ses') return new SesProvider(sending.ses)
    await this.targets.assertAllowed({ host: sending.smtp.host, port: sending.smtp.port })

    return new SmtpProvider(sending.smtp)
  }

  /** A new (uncached) storage provider for `storage`, e.g. unsaved settings under test. */
  async buildStorage(storage: StorageSettings): Promise<StorageProvider> {
    if (!URL.canParse(storage.endpoint)) return new S3StorageProvider(storage)
    const target = OutboundTargetPolicy.targetOf(new URL(storage.endpoint))
    await this.targets.assertAllowed(target)

    return new S3StorageProvider(storage, this.targets.lookupFor(target))
  }

  async email(): Promise<EmailProvider> {
    if (this.overrides.email) return this.overrides.email
    const sending = await this.settings.get('sending')
    const config = sending.provider === 'ses' ? sending.ses : sending.smtp
    const fingerprint = JSON.stringify([sending.provider, config])

    if (this.emailCache?.fingerprint !== fingerprint) {
      const provider = await this.buildEmail(sending)
      this.emailCache?.provider.close?.()
      this.emailCache = { fingerprint, provider }
    }

    return this.emailCache.provider
  }

  async storage(): Promise<StorageProvider> {
    if (this.overrides.storage) return this.overrides.storage
    const storage = await this.settings.get('storage')
    const fingerprint = JSON.stringify(storage)

    if (this.storageCache?.fingerprint !== fingerprint) {
      const provider = await this.buildStorage(storage)
      this.storageCache?.provider.close?.()
      this.storageCache = { fingerprint, provider }
    }

    return this.storageCache.provider
  }

  /** Closes cached connections (organization container evicted or disposed). */
  dispose(): void {
    this.emailCache?.provider.close?.()
    this.storageCache?.provider.close?.()
    this.emailCache = undefined
    this.storageCache = undefined
  }
}
