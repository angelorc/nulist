import type { Database, DatabaseHandle } from '../../db/client'
import { createDatabase } from '../../db/client'
import { ApiLogRecorder } from '../api/ApiLogService'
import { AuditLogger } from '../audit/AuditLogger'
import type { ProviderOverrides } from '../email/ProviderRegistry'
import { SesEventProcessor } from '../events/SesEventProcessor'
import { SnsPayloadVerifier } from '../events/SnsVerifier'
import type { SnsVerifier } from '../events/SnsVerifier'
import { OrganizationAudit } from '../organizations/OrganizationAudit'
import { OrganizationService } from '../organizations/OrganizationService'
import { PublicContextResolver } from '../organizations/PublicContextResolver'
import { ClientAddressResolver } from '../security/ClientAddress'
import { OutboundHttpClient } from '../security/OutboundHttpClient'
import { OutboundTargetPolicy } from '../security/OutboundTargetPolicy'
import type { OutboundPolicyOptions } from '../security/OutboundTargetPolicy'
import { SecretBox } from '../security/SecretBox'
import { TokenService } from '../security/TokenService'
import { buildDefaultSettings } from '../settings/defaults'
import type { EnvDefaults } from '../settings/defaults'
import { TemplateRenderer } from '../templates/TemplateRenderer'
import type { WebhookDispatcher } from '../webhooks/WebhookDispatcher'
import type { SettingsMap } from '../../../shared/types/domain'
import type { JobLauncher } from './jobs'
import { RecordingJobLauncher } from './jobs'
import { OrganizationContainer } from './OrganizationContainer'
import type { PlatformInfrastructure } from './OrganizationContainer'
import { TenantScope } from './TenantScope'

export interface AppConfig {
  databaseUrl: string
  appSecret: string
  /** Public base URL used in recipient-facing links. */
  appUrl: string
  /** Allowed SNS topic ARNs for the SES webhook (empty = none: SES events are refused). */
  snsTopicArns: string[]
  /** Organization containers kept in memory (least recently used ones are dropped). */
  organizationCacheSize: number
  /**
   * Where organization-configured connections (webhooks, SMTP, S3) may go. The
   * instance's own SMTP host and S3 endpoint (`defaults`) are always allowed.
   */
  outbound?: Partial<OutboundPolicyOptions>
  /** Reverse proxies whose X-Forwarded-For is believed (IPs, CIDRs or `loopback`); none by default. */
  trustedProxies?: string[]
  defaults?: Partial<EnvDefaults>
}

/** Seams used by tests to replace infrastructure. */
export interface ContainerOverrides {
  db?: Database
  jobs?: JobLauncher
  providers?: ProviderOverrides
  snsVerifier?: SnsVerifier
  webhooks?: WebhookDispatcher
}

/** Bounded least-recently-used cache of organization containers; evicted ones are disposed. */
class OrganizationContainerCache {
  private readonly entries = new Map<string, OrganizationContainer>()

  constructor(private readonly capacity: number) {}

  get(organizationId: string, create: () => OrganizationContainer): OrganizationContainer {
    const cached = this.entries.get(organizationId)

    if (cached) {
      // Re-insert to mark it as most recently used.
      this.entries.delete(organizationId)
      this.entries.set(organizationId, cached)

      return cached
    }

    const created = create()
    this.entries.set(organizationId, created)

    for (const [key, evicted] of this.entries) {
      if (this.entries.size <= this.capacity) break
      this.entries.delete(key)
      evicted.dispose()
    }

    return created
  }

  /** Drops one organization (deleted) or every organization. */
  clear(organizationId?: string): void {
    for (const [key, container] of this.entries) {
      if (organizationId && key !== organizationId) continue
      this.entries.delete(key)
      container.dispose()
    }
  }
}

/**
 * Composition root of the platform: instance-wide infrastructure (database,
 * jobs, secrets, tokens, renderer, SES events) and instance-level services
 * (organizations, public context). Tenant services live in an
 * OrganizationContainer obtained with `forOrganization(organizationId)`.
 */
export class Container {
  private handleInstance?: DatabaseHandle
  private jobsInstance?: JobLauncher
  private secretBoxInstance?: SecretBox
  private tokensInstance?: TokenService
  private rendererInstance?: TemplateRenderer
  private defaultSettingsInstance?: SettingsMap
  private auditInstance?: AuditLogger
  private apiLogRecorderInstance?: ApiLogRecorder
  private organizationsInstance?: OrganizationService
  private organizationAuditInstance?: OrganizationAudit
  private publicContextInstance?: PublicContextResolver
  private snsVerifierInstance?: SnsVerifier
  private sesEventsInstance?: SesEventProcessor
  private outboundPolicyInstance?: OutboundTargetPolicy
  private outboundHttpInstance?: OutboundHttpClient
  private clientAddressInstance?: ClientAddressResolver
  private readonly tenants: OrganizationContainerCache

  constructor(
    readonly config: AppConfig,
    private readonly overrides: ContainerOverrides = {}
  ) {
    this.tenants = new OrganizationContainerCache(Math.max(1, config.organizationCacheSize))
  }

  // Infrastructure -----------------------------------------------------------
  get db(): Database {
    if (this.overrides.db) return this.overrides.db

    return (this.handleInstance ??= createDatabase(this.config.databaseUrl)).db
  }

  get jobs(): JobLauncher {
    return (this.jobsInstance ??= this.overrides.jobs ?? new RecordingJobLauncher())
  }

  get secretBox(): SecretBox {
    return (this.secretBoxInstance ??= new SecretBox(this.config.appSecret))
  }

  get tokens(): TokenService {
    return (this.tokensInstance ??= new TokenService(this.config.appSecret))
  }

  get renderer(): TemplateRenderer {
    return (this.rendererInstance ??= new TemplateRenderer())
  }

  /** Settings every organization starts from (environment defaults). */
  get defaultSettings(): SettingsMap {
    return (this.defaultSettingsInstance ??= buildDefaultSettings(this.config.defaults))
  }

  /** Guards connections to organization-configured hosts (no internal networks). */
  get outboundPolicy(): OutboundTargetPolicy {
    return (this.outboundPolicyInstance ??= new OutboundTargetPolicy({
      allowPrivateNetworks: this.config.outbound?.allowPrivateNetworks ?? false,
      allowedTargets: [...(this.config.outbound?.allowedTargets ?? []), ...this.instanceTargets()]
    }))
  }

  get outboundHttp(): OutboundHttpClient {
    return (this.outboundHttpInstance ??= new OutboundHttpClient(this.outboundPolicy))
  }

  /** Client IPs of requests (X-Forwarded-For only from trusted proxies). */
  get clientAddress(): ClientAddressResolver {
    return (this.clientAddressInstance ??= new ClientAddressResolver(
      this.config.trustedProxies ?? []
    ))
  }

  // Instance-level services --------------------------------------------------
  /** Audit trail of instance-level actions (organization of the actor, or none). */
  get audit(): AuditLogger {
    return (this.auditInstance ??= new AuditLogger(null, this.db))
  }

  /** REST API requests rejected before a key (and so an organization) was known. */
  get apiLogRecorder(): ApiLogRecorder {
    return (this.apiLogRecorderInstance ??= new ApiLogRecorder(this.db))
  }

  get organizations(): OrganizationService {
    return (this.organizationsInstance ??= new OrganizationService(this.db, this.audit, this))
  }

  /** Audit entries for Better Auth organization hooks (members, invitations, organizations). */
  get organizationAudit(): OrganizationAudit {
    return (this.organizationAuditInstance ??= new OrganizationAudit(this.audit))
  }

  /** Resolves the organization behind public links and forms. */
  get publicContext(): PublicContextResolver {
    return (this.publicContextInstance ??= new PublicContextResolver(
      this.tokens,
      this.organizations,
      this
    ))
  }

  get snsVerifier(): SnsVerifier {
    return (this.snsVerifierInstance ??=
      this.overrides.snsVerifier ?? new SnsPayloadVerifier(this.config.snsTopicArns))
  }

  /** SES events arrive instance-wide and are applied in the organization of their message. */
  get sesEvents(): SesEventProcessor {
    return (this.sesEventsInstance ??= new SesEventProcessor(this.db, this))
  }

  // Organizations ------------------------------------------------------------
  /** Every tenant service of one organization (cached, least recently used dropped). */
  forOrganization(organizationId: string): OrganizationContainer {
    return this.tenants.get(
      organizationId,
      () => new OrganizationContainer(new TenantScope(organizationId), this.infrastructure())
    )
  }

  /** Forgets cached services of an organization (after it was deleted), or of all. */
  evictOrganization(organizationId?: string): void {
    this.tenants.clear(organizationId)
  }

  async dispose(): Promise<void> {
    this.tenants.clear()
    await this.handleInstance?.pool.end()
  }

  /** The instance's own SMTP relay and S3 endpoint (from the environment), as `host:port`. */
  private instanceTargets(): string[] {
    const { sending, storage } = this.defaultSettings
    const targets = sending.smtp.host ? [`${sending.smtp.host}:${sending.smtp.port}`] : []

    if (URL.canParse(storage.endpoint)) {
      const { host, port } = OutboundTargetPolicy.targetOf(new URL(storage.endpoint))
      targets.push(`${host}:${port}`)
    }

    return targets
  }

  private infrastructure(): PlatformInfrastructure {
    return {
      db: this.db,
      jobs: this.jobs,
      renderer: this.renderer,
      tokens: this.tokens,
      secretBox: this.secretBox,
      sesEvents: this.sesEvents,
      outboundPolicy: this.outboundPolicy,
      outboundHttp: this.outboundHttp,
      appUrl: this.config.appUrl,
      defaultSettings: this.defaultSettings,
      providerOverrides: this.overrides.providers,
      webhookOverride: this.overrides.webhooks
    }
  }
}
