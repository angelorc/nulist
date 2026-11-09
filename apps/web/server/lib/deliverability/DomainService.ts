import {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  SESv2Client,
  paginateListEmailIdentities
} from '@aws-sdk/client-sesv2'
import type {
  CreateEmailIdentityCommandOutput,
  GetEmailIdentityResponse,
  Tag
} from '@aws-sdk/client-sesv2'
import { z } from 'zod'
import type {
  DomainCheckResult,
  DomainIdentity,
  DomainOverview,
  IdentityStatus,
  MailFromInput
} from '../../../shared/schemas/domains'
import type { SendingSettings } from '../../../shared/types/domain'
import {
  ConflictError,
  DomainError,
  InvalidStateError,
  NotFoundError,
  ProviderError,
  ValidationError
} from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import type { ProviderRegistry } from '../email/ProviderRegistry'
import { SesProvider } from '../email/SesProvider'
import type { SettingsService } from '../settings/SettingsService'
import { DnsChecker } from './DnsChecker'
import { DnsRecordPlan } from './DnsRecordPlan'
import { IdentityOwnership } from './IdentityOwnership'

/** How mail leaves mlist, as far as domain authentication is concerned. */
export interface SendingContext {
  /** SES API credentials are available: identities can be listed and created. */
  managed: boolean
  /** Mail goes out through Amazon SES (API, or the SES SMTP interface). */
  viaSes: boolean
  region: string | null
}

export interface CheckDomainOptions {
  dkimTokens?: string[]
  /** `undefined` = use the SES identity's MAIL FROM when known; `''` = none. */
  mailFromDomain?: string
}

/** An SES client for one operation, with the organization's view of the account. */
interface SesSession {
  client: SESv2Client
  region: string
  ownership: IdentityOwnership
  /** Releases a client built for this operation (the provider's own client is kept). */
  release(): void
}

const SES_SMTP_HOST = /^email-smtp(?:-fips)?\.([a-z0-9-]+)\.amazonaws\.com$/i

/** Concurrent GetEmailIdentity calls while listing (SES control-plane APIs are rate limited). */
const DESCRIBE_CONCURRENCY = 3

const CREDENTIAL_ERRORS = new Set([
  'UnrecognizedClientException',
  'InvalidClientTokenId',
  'SignatureDoesNotMatch',
  'AccessDeniedException',
  'CredentialsProviderError',
  'ExpiredTokenException'
])

/** Name and message of an AWS SDK (or any) error. */
const awsErrorSchema = z
  .object({
    name: z.string().catch('Error'),
    message: z.string().catch('Unknown error')
  })
  .catch({ name: 'Error', message: 'Unknown error' })

type AwsError = z.output<typeof awsErrorSchema>

function identityStatus(status: string | null | undefined): IdentityStatus {
  switch (status) {
    case 'SUCCESS':
      return 'verified'
    case 'PENDING':
      return 'pending'
    case 'FAILED':
      return 'failed'
    case 'TEMPORARY_FAILURE':
      return 'temporary_failure'
    default:
      return 'not_started'
  }
}

/** Runs `fn` over `items` with at most `limit` calls in flight; results keep the input order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  const queue = items.entries()

  // Workers share one iterator, so each item is taken exactly once.
  const worker = async (): Promise<void> => {
    const next = queue.next()

    if (next.done) return
    const [index, item] = next.value
    results[index] = await fn(item)

    return worker()
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))

  return results
}

/** The SES identity that authorizes a From address, and whether the organization owns it. */
export interface SenderIdentity {
  name: string
  owned: boolean
}

/**
 * Identities SES can authorize `address` with, most specific first: the address,
 * its domain, then each parent domain (never a bare top-level domain).
 */
function senderIdentityCandidates(address: string): string[] {
  const email = address.trim().toLowerCase()
  const labels = (email.split('@')[1] ?? '').split('.').filter(Boolean)
  const domains = labels.slice(0, -1).map((_, index) => labels.slice(index).join('.'))

  return [email, ...domains]
}

/** Domains first, then email addresses, each alphabetically. */
function compareIdentities(a: DomainIdentity, b: DomainIdentity): number {
  if (a.type === b.type) return a.name.localeCompare(b.name)

  return a.type === 'domain' ? -1 : 1
}

/**
 * Sending domains of one organization: SES identity management (SESv2) plus
 * provider-agnostic DNS checks (SPF, DKIM, DMARC, MAIL FROM MX) for any domain.
 * Identities belong to the organization through an SES tag (IdentityOwnership);
 * identities of other organizations behave as not found.
 */
export class DomainService {
  constructor(
    protected readonly scope: TenantScope,
    protected readonly providers: ProviderRegistry,
    protected readonly settings: SettingsService,
    private readonly dnsChecker: DnsChecker = new DnsChecker()
  ) {}

  /** Whether identities can be managed and which region/provider is in use. */
  async context(): Promise<SendingContext> {
    const sending = await this.settings.get('sending')

    return DomainService.contextFrom(sending)
  }

  static contextFrom(sending: SendingSettings): SendingContext {
    const smtpRegion = SES_SMTP_HOST.exec(sending.smtp.host.trim())?.[1]?.toLowerCase() ?? null
    const viaSes = sending.provider === 'ses' || !!smtpRegion || sending.smtp.sesHeaders

    const region =
      sending.provider === 'ses'
        ? sending.ses.region
        : (smtpRegion ?? (viaSes ? sending.ses.region : ''))

    const managed =
      sending.provider === 'ses' || !!(sending.ses.accessKeyId && sending.ses.secretAccessKey)

    return { managed, viaSes, region: region || null }
  }

  async overview(): Promise<DomainOverview> {
    const context = await this.context()

    return { ...context, identities: context.managed ? await this.listIdentities() : [] }
  }

  /** The organization's identities in the SES account. */
  async listIdentities(): Promise<DomainIdentity[]> {
    return this.withSes(async (ses) => {
      const names = await this.identityNames(ses)

      const described = await mapLimit(names, DESCRIBE_CONCURRENCY, async (name) => ({
        name,
        response: await this.describe(ses, name)
      }))

      return described
        .flatMap(({ name, response }) =>
          ses.ownership.owns(response.Tags) ? [this.toIdentity(name, response, ses.region)] : []
        )
        .toSorted(compareIdentities)
    })
  }

  async getIdentity(name: string): Promise<DomainIdentity> {
    return this.withSes(
      async (ses) => this.toIdentity(name, await this.describeOwned(ses, name), ses.region),
      name
    )
  }

  /**
   * The identity Amazon SES authorizes `address` with: the most specific verified
   * identity among the address, its domain and parent domains, with whether it
   * belongs to the organization. Null when no such identity is verified.
   */
  async senderIdentity(address: string): Promise<SenderIdentity | null> {
    return this.withSes(async (ses) => {
      for (const name of senderIdentityCandidates(address)) {
        const response = await this.describeIfExists(ses, name)

        if (response?.VerifiedForSendingStatus)
          return { name, owned: ses.ownership.owns(response.Tags) }
      }

      return null
    }, address)
  }

  /**
   * Creates an SES domain identity with Easy DKIM, tagged with the organization,
   * and returns the records to publish. A domain that already exists in the
   * account is a conflict, whoever owns it.
   */
  async addDomain(domain: string): Promise<DomainIdentity> {
    return this.withSes(async (ses) => {
      const created = await this.createIdentity(ses, domain)

      return this.toIdentity(
        domain,
        {
          IdentityType: created.IdentityType,
          VerifiedForSendingStatus: created.VerifiedForSendingStatus,
          DkimAttributes: created.DkimAttributes,
          VerificationStatus: created.VerifiedForSendingStatus ? 'SUCCESS' : 'PENDING'
        },
        ses.region
      )
    }, domain)
  }

  async removeIdentity(name: string): Promise<void> {
    await this.withSes(async (ses) => {
      await this.describeOwned(ses, name)
      await ses.client.send(new DeleteEmailIdentityCommand({ EmailIdentity: name }))
    }, name)
  }

  /** Configures (or clears, with an empty domain) the custom MAIL FROM domain of an identity. */
  async setMailFrom(domain: string, input: MailFromInput): Promise<DomainIdentity> {
    const mailFromDomain = input.mailFromDomain.trim().toLowerCase()

    if (mailFromDomain && !mailFromDomain.endsWith(`.${domain}`)) {
      throw new ValidationError(
        `The MAIL FROM domain must be a subdomain of ${domain}, such as mail.${domain}.`,
        { field: 'mailFromDomain' }
      )
    }

    return this.withSes(async (ses) => {
      await this.describeOwned(ses, domain)
      await ses.client.send(
        new PutEmailIdentityMailFromAttributesCommand({
          EmailIdentity: domain,
          MailFromDomain: mailFromDomain || undefined,
          BehaviorOnMxFailure: input.behaviorOnMxFailure
        })
      )

      return this.toIdentity(domain, await this.describe(ses, domain), ses.region)
    }, domain)
  }

  /**
   * Live DNS checks for any domain. When the organization manages the domain in
   * SES and no tokens are given, its DKIM tokens and MAIL FROM domain are looked up.
   */
  async checkDomain(domain: string, options: CheckDomainOptions = {}): Promise<DomainCheckResult> {
    const sending = await this.settings.get('sending')
    const context = DomainService.contextFrom(sending)
    let dkimTokens = options.dkimTokens?.filter(Boolean) ?? []
    let mailFromDomain = options.mailFromDomain

    if (context.managed && (!dkimTokens.length || mailFromDomain === undefined)) {
      const identity = await this.getIdentity(domain).catch(() => null)

      if (identity) {
        if (!dkimTokens.length) dkimTokens = identity.dkim.tokens

        if (mailFromDomain === undefined) mailFromDomain = identity.mailFrom.domain ?? ''
      }
    }

    const ses = context.viaSes || dkimTokens.length > 0

    return this.dnsChecker.check({
      domain,
      dkimTokens,
      mailFromDomain: mailFromDomain || null,
      region: context.region ?? (ses ? sending.ses.region || null : null),
      ses
    })
  }

  // ---------------------------------------------------------------------------
  // SES plumbing
  // ---------------------------------------------------------------------------

  /** Runs `run` with an SES session, maps SES errors and releases the session. */
  private async withSes<T>(run: (ses: SesSession) => Promise<T>, subject?: string): Promise<T> {
    const ses = await this.session()

    try {
      return await run(ses)
    } catch (cause) {
      throw this.sesError(cause, subject)
    } finally {
      ses.release()
    }
  }

  /**
   * Reuses the SesProvider client when SES is the active provider, otherwise
   * builds a client from the SES API keys for this operation only. Access keys
   * mean the organization's own AWS account; none means the server's credential
   * chain, which every organization shares.
   */
  protected async session(): Promise<SesSession> {
    const sending = await this.settings.get('sending')
    const region = sending.ses.region || 'us-east-1'
    const dedicated = !!(sending.ses.accessKeyId && sending.ses.secretAccessKey)

    const ownership = new IdentityOwnership(
      this.scope.organizationId,
      dedicated ? 'dedicated' : 'shared'
    )

    if (sending.provider === 'ses') {
      const provider = await this.providers.email()

      if (provider instanceof SesProvider)
        return { client: provider.client, region, ownership, release: () => {} }
    }

    if (sending.provider !== 'ses' && !dedicated) {
      throw new InvalidStateError(
        'Domain management needs Amazon SES API credentials. Add them in Settings → Sending.'
      )
    }

    const client = new SESv2Client({
      region,
      credentials: dedicated
        ? { accessKeyId: sending.ses.accessKeyId, secretAccessKey: sending.ses.secretAccessKey }
        : undefined
    })

    return { client, region, ownership, release: () => client.destroy() }
  }

  /** Every identity name in the account and region (managed domains excluded). */
  private async identityNames(ses: SesSession): Promise<string[]> {
    const names: string[] = []

    for await (const page of paginateListEmailIdentities(
      { client: ses.client },
      { PageSize: 100 }
    )) {
      for (const info of page.EmailIdentities ?? []) {
        if (info.IdentityName && info.IdentityType !== 'MANAGED_DOMAIN')
          names.push(info.IdentityName)
      }
    }

    return names
  }

  /**
   * Creates the identity with the organization tag. On its own AWS account an
   * organization may lack `ses:TagResource`; the identity is then created untagged,
   * which still belongs to it there. The shared account always requires the tag.
   */
  private async createIdentity(
    ses: SesSession,
    domain: string
  ): Promise<CreateEmailIdentityCommandOutput> {
    const create = (tags: Tag[] | undefined) =>
      ses.client.send(new CreateEmailIdentityCommand({ EmailIdentity: domain, Tags: tags }))

    try {
      return await create(ses.ownership.tags)
    } catch (cause) {
      const { name } = awsErrorSchema.parse(cause)

      if (name === 'AccessDeniedException' && ses.ownership.allowsUntagged) return create(undefined)

      if (name === 'AccessDeniedException')
        throw new ProviderError(
          'Adding domains with the server AWS credentials needs the ses:TagResource permission, so each domain is assigned to its organization.',
          false,
          name
        )

      throw cause
    }
  }

  private async describe(ses: SesSession, name: string): Promise<GetEmailIdentityResponse> {
    return ses.client.send(new GetEmailIdentityCommand({ EmailIdentity: name }))
  }

  /** The identity, or null when it does not exist in the account. */
  private async describeIfExists(
    ses: SesSession,
    name: string
  ): Promise<GetEmailIdentityResponse | null> {
    try {
      return await this.describe(ses, name)
    } catch (cause) {
      if (awsErrorSchema.parse(cause).name === 'NotFoundException') return null
      throw cause
    }
  }

  /** The identity, when it belongs to the organization (NotFoundError otherwise, without leaking it exists). */
  private async describeOwned(ses: SesSession, name: string): Promise<GetEmailIdentityResponse> {
    const response = await this.describe(ses, name)

    if (!ses.ownership.owns(response.Tags)) throw new NotFoundError('Identity', name)

    return response
  }

  private toIdentity(
    name: string,
    response: GetEmailIdentityResponse,
    region: string
  ): DomainIdentity {
    const type = response.IdentityType === 'EMAIL_ADDRESS' ? 'email' : 'domain'
    const tokens = response.DkimAttributes?.Tokens ?? []
    const mailFromDomain = response.MailFromAttributes?.MailFromDomain || null

    const plan = new DnsRecordPlan({
      domain: name,
      dkimTokens: tokens,
      mailFromDomain,
      region,
      ses: true
    })

    return {
      name,
      type,
      status: identityStatus(
        response.VerificationStatus ?? (response.VerifiedForSendingStatus ? 'SUCCESS' : undefined)
      ),
      sendingEnabled: response.VerifiedForSendingStatus ?? false,
      dkim: {
        status: identityStatus(response.DkimAttributes?.Status),
        signingEnabled: response.DkimAttributes?.SigningEnabled ?? false,
        tokens
      },
      mailFrom: {
        domain: mailFromDomain,
        status: mailFromDomain
          ? identityStatus(response.MailFromAttributes?.MailFromDomainStatus)
          : null,
        behaviorOnMxFailure: response.MailFromAttributes?.BehaviorOnMxFailure ?? 'USE_DEFAULT_VALUE'
      },
      records: type === 'domain' ? plan.records() : []
    }
  }

  /** Maps AWS SDK errors to client-safe domain errors. */
  private sesError(cause: unknown, subject?: string): DomainError {
    if (cause instanceof DomainError) return cause

    return DomainService.fromAwsError(awsErrorSchema.parse(cause), subject)
  }

  private static fromAwsError({ name, message }: AwsError, subject?: string): DomainError {
    if (name === 'NotFoundException') return new NotFoundError('Identity', subject)

    if (name === 'AlreadyExistsException')
      return new ConflictError(
        `${subject ?? 'This identity'} is already set up in Amazon SES.`,
        'already_exists'
      )

    if (name === 'BadRequestException')
      return new ValidationError(`SES rejected the request: ${message}`)

    if (name === 'LimitExceededException')
      return new DomainError(
        'SES identity limit reached for this account and region.',
        409,
        'limit_exceeded'
      )

    if (name === 'TooManyRequestsException' || name === 'ThrottlingException')
      return new ProviderError('SES is throttling requests. Try again in a moment.', true, name)

    if (CREDENTIAL_ERRORS.has(name))
      return new ProviderError(
        `SES rejected the credentials (${name}). Check the access key and region in Settings → Sending.`,
        false,
        name
      )

    return new ProviderError(`SES request failed: ${message}`, false, name)
  }
}
