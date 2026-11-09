import { parseMailbox } from '../../../shared/schemas/transactional'
import type { SendingSettings } from '../../../shared/types/domain'
import { ValidationError } from '../core/errors'
import type { SettingsService } from '../settings/SettingsService'
import type { DomainService } from './DomainService'
import type { SesAccountKind } from './IdentityOwnership'

export type SenderVerdict = { allowed: true } | { allowed: false; reason: string }

interface CachedVerdict {
  verdict: SenderVerdict
  expiresAt: number
}

const ALLOWED: SenderVerdict = { allowed: true }

/** How long an SES identity lookup is reused (SES control-plane APIs are rate limited). */
const VERDICT_TTL_MS = 60_000

/** Cached addresses per organization before expired entries are dropped. */
const MAX_CACHED = 1_000

/**
 * Which From addresses one organization may send with. On the instance's shared
 * SES account (provider SES without access keys) SES accepts any address of an
 * identity verified by ANY organization and signs it with that identity's DKIM,
 * so an organization may only use identities it owns (IdentityOwnership).
 * A dedicated SES account or an SMTP server of its own is the organization's
 * business: the provider decides there.
 */
export class SenderPolicy {
  private readonly verdicts = new Map<string, CachedVerdict>()

  constructor(
    private readonly settings: SettingsService,
    private readonly domains: DomainService,
    private readonly ttlMs = VERDICT_TTL_MS
  ) {}

  /** The SES account mail goes out through, or null when SES is not the provider. */
  static sesAccount(sending: SendingSettings): SesAccountKind | null {
    if (sending.provider !== 'ses') return null

    return sending.ses.accessKeyId && sending.ses.secretAccessKey ? 'dedicated' : 'shared'
  }

  /** Whether the organization may send from `from` (an address or `"Name" <address>`). */
  async check(from: string): Promise<SenderVerdict> {
    if (SenderPolicy.sesAccount(await this.settings.get('sending')) !== 'shared') return ALLOWED

    const address = parseMailbox(from).email.toLowerCase()
    const now = Date.now()
    const cached = this.verdicts.get(address)

    if (cached && cached.expiresAt > now) return cached.verdict

    const identity = await this.domains.senderIdentity(address)
    const domain = address.split('@')[1] ?? address

    const verdict: SenderVerdict = identity?.owned
      ? ALLOWED
      : {
          allowed: false,
          reason: `${domain} is not a verified sending domain of this organization. Add and verify it under Domains before sending from ${address}.`
        }

    this.remember(address, verdict, now)

    return verdict
  }

  /** Throws a ValidationError (on `field`) when the organization may not send from `from`. */
  async assertAllowed(from: string, field = 'from'): Promise<void> {
    const verdict = await this.check(from)

    if (!verdict.allowed) throw new ValidationError(verdict.reason, { field })
  }

  private remember(address: string, verdict: SenderVerdict, now: number): void {
    if (this.verdicts.size >= MAX_CACHED) {
      for (const [key, entry] of this.verdicts) {
        if (entry.expiresAt <= now) this.verdicts.delete(key)
      }

      if (this.verdicts.size >= MAX_CACHED) this.verdicts.clear()
    }

    this.verdicts.set(address, { verdict, expiresAt: now + this.ttlMs })
  }
}
