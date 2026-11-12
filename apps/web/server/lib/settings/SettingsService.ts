import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { Database } from '../../db/client'
import { settings as settingsTable } from '../../db/schema'
import type { SettingsMap, SettingsSection } from '../../../shared/types/domain'
import {
  MASKED_SECRET,
  generalSettingsSchema,
  limitSettingsSchema,
  sendingSettingsSchema,
  settingsSchemas,
  storageSettingsSchema
} from '../../../shared/schemas/settings'
import { BlockedTargetError, OutboundTargetPolicy } from '../security/OutboundTargetPolicy'
import type { OutboundTarget } from '../security/OutboundTargetPolicy'
import type { SecretBox } from '../security/SecretBox'
import { ForbiddenError, ValidationError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import { generalDefaults } from './defaults'
import { isOrgSettingsSection } from './sections'
import type { OrgSettingsSection } from './sections'

/** What callers send for a section (before validation; secrets may be masked). */
export type SettingsInput<S extends SettingsSection> = z.input<(typeof settingsSchemas)[S]>

/** Stored value of any section, as read from the jsonb column. */
type StoredSection = SettingsMap[SettingsSection]

export interface SettingsChange<S extends SettingsSection> {
  /** Masked values, safe for audit logs and the browser. */
  before: SettingsMap[S]
  after: SettingsMap[S]
}

/** A secret inside a section: encrypted at rest, masked in the UI. */
interface SecretField<S extends SettingsSection> {
  /** Dotted path, used in validation errors. */
  path: string
  read(value: SettingsMap[S]): string
  write(value: SettingsMap[S], secret: string): SettingsMap[S]
  /**
   * Where the secret is sent. A masked secret only keeps its stored value while
   * the target is unchanged, so nobody can redirect a saved password to another host.
   */
  target(value: SettingsMap[S]): string
}

/** Validation, default merging and secrets of one section. */
interface SectionCodec<S extends SettingsSection> {
  parse(input: SettingsInput<S>): SettingsMap[S]
  merge(defaults: SettingsMap[S], stored: StoredSection | undefined): SettingsMap[S]
  secrets: readonly SecretField<S>[]
}

function validate<T, I>(section: SettingsSection, schema: z.ZodType<T, I>, input: I): T {
  const parsed = schema.safeParse(input)

  if (parsed.success) return parsed.data
  const first = parsed.error.issues[0]

  throw new ValidationError(
    first
      ? `Invalid settings: ${first.path.join('.') || section} ${first.message.toLowerCase()}`
      : 'Invalid settings',
    { issues: parsed.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })) }
  )
}

const SES_SMTP_PASSWORD = /^B[A-Za-z0-9+/]{43}$/

const generalPartial = generalSettingsSchema.partial()

const sendingPartial = sendingSettingsSchema
  .extend({
    ses: sendingSettingsSchema.shape.ses.partial(),
    smtp: sendingSettingsSchema.shape.smtp.partial()
  })
  .partial()

const storagePartial = storageSettingsSchema.partial()
const limitsPartial = limitSettingsSchema.partial()

/** Stored rows are validated (partially) before they are merged over the defaults. */
function storedPatch<T>(schema: z.ZodType<T>, stored: StoredSection | undefined): T | undefined {
  if (stored === undefined) return undefined
  const parsed = schema.safeParse(stored)

  if (!parsed.success) console.warn('[settings] ignoring an invalid stored settings section')

  return parsed.success ? parsed.data : undefined
}

/** One codec per section, keyed so `CODECS[section]` is `SectionCodec<typeof section>`. */
type SectionCodecs = { readonly [S in SettingsSection]: SectionCodec<S> }

const CODECS: SectionCodecs = {
  general: {
    parse: (input) => validate('general', generalSettingsSchema, input),
    merge: (defaults, stored) => ({ ...defaults, ...storedPatch(generalPartial, stored) }),
    secrets: []
  },
  sending: {
    parse(input) {
      const value = validate('sending', sendingSettingsSchema, input)

      if (value.provider === 'ses' && !value.ses.region)
        throw new ValidationError('Choose the AWS region of your SES account.', {
          field: 'ses.region'
        })

      if (SES_SMTP_PASSWORD.test(value.ses.secretAccessKey))
        throw new ValidationError(
          'This is an SES SMTP password, not an AWS secret access key. Paste the 40-character secret access key of the IAM user, or use the SMTP provider.',
          { field: 'ses.secretAccessKey' }
        )

      if (value.provider === 'smtp' && !value.smtp.host)
        throw new ValidationError('Enter the SMTP host.', { field: 'smtp.host' })

      return value
    },
    merge(defaults, stored) {
      const patch = storedPatch(sendingPartial, stored)

      return {
        ...defaults,
        ...patch,
        ses: { ...defaults.ses, ...patch?.ses },
        smtp: { ...defaults.smtp, ...patch?.smtp }
      }
    },
    secrets: [
      {
        path: 'ses.secretAccessKey',
        read: (value) => value.ses.secretAccessKey,
        write: (value, secret) => ({ ...value, ses: { ...value.ses, secretAccessKey: secret } }),
        target: (value) => value.ses.accessKeyId
      },
      {
        path: 'smtp.pass',
        read: (value) => value.smtp.pass,
        write: (value, secret) => ({ ...value, smtp: { ...value.smtp, pass: secret } }),
        target: (value) => `${value.smtp.host.toLowerCase()}:${value.smtp.port}`
      }
    ]
  },
  storage: {
    parse: (input) => validate('storage', storageSettingsSchema, input),
    merge: (defaults, stored) => ({ ...defaults, ...storedPatch(storagePartial, stored) }),
    secrets: [
      {
        path: 'secretAccessKey',
        read: (value) => value.secretAccessKey,
        write: (value, secret) => ({ ...value, secretAccessKey: secret }),
        // Bucket and region too: the instance's default credentials must not follow an
        // organization to another bucket on the same endpoint.
        target: (value) =>
          `${value.endpoint.toLowerCase()}|${value.region}|${value.bucket}|${value.accessKeyId}`
      }
    ]
  },
  limits: {
    parse: (input) => validate('limits', limitSettingsSchema, input),
    merge: (defaults, stored) => ({ ...defaults, ...storedPatch(limitsPartial, stored) }),
    secrets: []
  }
}

interface CacheEntry<S extends SettingsSection> {
  value: SettingsMap[S]
  at: number
}

type SectionCache = { [S in SettingsSection]?: CacheEntry<S> }

/** Typed write into the per-section cache (the key decides the entry's type). */
function remember<S extends SettingsSection>(
  cache: { [K in S]?: CacheEntry<K> },
  section: S,
  entry: CacheEntry<S>
): void {
  cache[section] = entry
}

/**
 * Typed, sectioned settings of one organization, stored as JSON rows keyed by
 * (organization, section). Defaults come from the environment; secrets are
 * encrypted with SecretBox. One instance per organization container, so the
 * short read cache is per organization too.
 */
export class SettingsService {
  private cache: SectionCache = {}
  private static readonly TTL_MS = 5_000

  constructor(
    protected readonly scope: TenantScope,
    private readonly db: Database,
    private readonly box: SecretBox,
    private readonly defaults: SettingsMap,
    private readonly targets?: OutboundTargetPolicy
  ) {}

  /** A section with secrets decrypted (server-side use only). */
  async get<S extends SettingsSection>(section: S): Promise<SettingsMap[S]> {
    const hit = this.cache[section]

    if (hit && Date.now() - hit.at < SettingsService.TTL_MS) return structuredClone(hit.value)

    const [row] = await this.db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(and(this.scope.eq(settingsTable.organizationId), eq(settingsTable.key, section)))

    const codec: SectionCodec<S> = CODECS[section]
    let value = codec.merge(structuredClone(this.defaults[section]), row?.value)

    for (const secret of codec.secrets) {
      const stored = secret.read(value)

      if (stored) value = secret.write(value, this.box.decrypt(stored))
    }

    remember(this.cache, section, { value, at: Date.now() })

    return structuredClone(value)
  }

  /** Same as `get` but secrets are replaced by a mask (safe to send to the browser). */
  async getMasked<S extends SettingsSection>(section: S): Promise<SettingsMap[S]> {
    return this.mask(section, await this.get(section))
  }

  /**
   * Validates and persists a section an organization may manage. Masked secrets
   * keep their stored value. Returns the previous and next (masked) values for auditing.
   */
  async update<S extends OrgSettingsSection>(
    section: S,
    input: SettingsInput<S>
  ): Promise<SettingsChange<S>> {
    if (!isOrgSettingsSection(section))
      throw new ForbiddenError('Limits are managed by your instance administrator.')

    await this.assertOutboundTargets(CODECS[section].parse(input))

    return this.write(section, input)
  }

  /** An organization's SMTP host and S3 endpoint must not point at the instance's internal network. */
  private async assertOutboundTargets(value: SettingsMap[OrgSettingsSection]): Promise<void> {
    const checks: [string, OutboundTarget][] = []

    if ('smtp' in value && value.provider === 'smtp' && value.smtp.host)
      checks.push(['smtp.host', { host: value.smtp.host, port: value.smtp.port }])

    if ('endpoint' in value && URL.canParse(value.endpoint))
      checks.push(['endpoint', OutboundTargetPolicy.targetOf(new URL(value.endpoint))])

    for (const [field, target] of checks) {
      if ((await this.targets?.check(target)) === 'blocked')
        throw new ValidationError(new BlockedTargetError(target.host).message, { field })
    }
  }

  /** Instance administrators only (OrganizationService): the organization's quotas. */
  async updateLimits(input: SettingsInput<'limits'>): Promise<SettingsChange<'limits'>> {
    return this.write('limits', input)
  }

  /**
   * Validates a section without persisting it and resolves masked secrets to
   * their stored (decrypted) values. Used to test unsaved connection settings.
   */
  async preview<S extends OrgSettingsSection>(
    section: S,
    input: SettingsInput<S>
  ): Promise<SettingsMap[S]> {
    const codec: SectionCodec<S> = CODECS[section]

    return this.unmask(section, codec.parse(input), await this.get(section))
  }

  /** Seeds the general section of a new organization from its name (no-op when it exists). */
  async initialize(organizationName: string): Promise<void> {
    const value = generalDefaults(organizationName)

    await this.db
      .insert(settingsTable)
      .values(this.scope.values({ key: 'general' as const, value }))
      .onConflictDoNothing({ target: [settingsTable.organizationId, settingsTable.key] })
    this.invalidate('general')
  }

  invalidate(section?: SettingsSection): void {
    if (section) delete this.cache[section]
    else this.cache = {}
  }

  private async write<S extends SettingsSection>(
    section: S,
    input: SettingsInput<S>
  ): Promise<SettingsChange<S>> {
    const codec: SectionCodec<S> = CODECS[section]
    const current = await this.get(section)
    let next = this.unmask(section, codec.parse(input), current)

    for (const secret of codec.secrets) {
      const plain = secret.read(next)
      next = secret.write(next, plain ? this.box.encrypt(plain) : '')
    }

    await this.db
      .insert(settingsTable)
      .values(this.scope.values({ key: section, value: next }))
      .onConflictDoUpdate({
        target: [settingsTable.organizationId, settingsTable.key],
        set: { value: next, updatedAt: new Date() }
      })
    this.invalidate(section)

    return { before: this.mask(section, current), after: await this.getMasked(section) }
  }

  /** Replaces masked secrets in `next` with the stored ones, unless their target changed. */
  private unmask<S extends SettingsSection>(
    section: S,
    next: SettingsMap[S],
    current: SettingsMap[S]
  ): SettingsMap[S] {
    let value = next

    for (const secret of CODECS[section].secrets) {
      if (secret.read(value) !== MASKED_SECRET) continue

      if (secret.read(current) && secret.target(value) !== secret.target(current)) {
        throw new ValidationError(
          'The connection target changed: enter the secret again to use it there.',
          { field: secret.path }
        )
      }

      value = secret.write(value, secret.read(current))
    }

    return value
  }

  private mask<S extends SettingsSection>(section: S, value: SettingsMap[S]): SettingsMap[S] {
    let masked = structuredClone(value)

    for (const secret of CODECS[section].secrets)
      masked = secret.write(masked, secret.read(masked) ? MASKED_SECRET : '')

    return masked
  }
}
