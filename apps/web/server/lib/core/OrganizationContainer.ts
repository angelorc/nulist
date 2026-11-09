import type { Database } from '../../db/client'
import { AnalyticsService } from '../analytics/AnalyticsService'
import { ApiLogService } from '../api/ApiLogService'
import { BroadcastApi } from '../api/BroadcastApi'
import { ContactApi } from '../api/ContactApi'
import { ListApi } from '../api/ListApi'
import { TemplateApi } from '../api/TemplateApi'
import { AuditLogger } from '../audit/AuditLogger'
import { BroadcastService } from '../broadcasts/BroadcastService'
import { ContactService } from '../contacts/ContactService'
import { ImportService } from '../contacts/ImportService'
import { SuppressionService } from '../contacts/SuppressionService'
import { DomainService } from '../deliverability/DomainService'
import { SenderPolicy } from '../deliverability/SenderPolicy'
import { MessageSender } from '../email/MessageSender'
import { ProviderRegistry } from '../email/ProviderRegistry'
import type { ProviderOverrides } from '../email/ProviderRegistry'
import { InboundEventReader } from '../events/InboundEventReader'
import { SesEventApplier } from '../events/SesEventApplier'
import type { SesEventProcessor } from '../events/SesEventProcessor'
import { SesEventSimulator } from '../events/SesEventSimulator'
import { SuppressionAdmin } from '../events/SuppressionAdmin'
import { WebhookAdmin } from '../events/WebhookAdmin'
import { LimitService } from '../limits/LimitService'
import { ListService } from '../lists/ListService'
import { TopicService } from '../lists/TopicService'
import { LogService } from '../logs/LogService'
import { MessagePreview } from '../logs/MessagePreview'
import { OptInService } from '../optin/OptInService'
import { PreferenceService } from '../optin/PreferenceService'
import { PublicBrandReader } from '../optin/PublicBrand'
import { PublicSignup } from '../optin/PublicSignup'
import { WebViewRenderer } from '../optin/WebView'
import { InvitationService } from '../organizations/InvitationService'
import { MemberService } from '../organizations/MemberService'
import { OrganizationProfile } from '../organizations/OrganizationProfile'
import { SystemMail } from '../organizations/SystemMail'
import { AudienceResolver } from '../segments/AudienceResolver'
import { SegmentQueryBuilder } from '../segments/SegmentQueryBuilder'
import { SegmentService } from '../segments/SegmentService'
import { LinkBuilder } from '../security/LinkBuilder'
import type { OutboundHttpClient } from '../security/OutboundHttpClient'
import type { OutboundTargetPolicy } from '../security/OutboundTargetPolicy'
import type { SecretBox } from '../security/SecretBox'
import type { TokenService } from '../security/TokenService'
import type { ApiKeyIssuer } from '../settings/api-keys/ApiKeyIssuer'
import { ApiKeyService } from '../settings/api-keys/ApiKeyService'
import { SettingsDiagnostics } from '../settings/SettingsDiagnostics'
import { SettingsService } from '../settings/SettingsService'
import { FileService } from '../storage/FileService'
import { TemplatePreviewer } from '../templates/TemplatePreviewer'
import type { TemplateRenderer } from '../templates/TemplateRenderer'
import { TemplateService } from '../templates/TemplateService'
import { TemplateTestSender } from '../templates/TemplateTestSender'
import { TransactionalService } from '../transactional/TransactionalService'
import type { WebhookDispatcher } from '../webhooks/WebhookDispatcher'
import { WebhookService } from '../webhooks/WebhookService'
import type { SettingsMap } from '../../../shared/types/domain'
import type { JobLauncher } from './jobs'
import type { TenantScope } from './TenantScope'

/** Instance-wide infrastructure an organization container reuses (from the root Container). */
export interface PlatformInfrastructure {
  readonly db: Database
  readonly jobs: JobLauncher
  readonly renderer: TemplateRenderer
  readonly tokens: TokenService
  readonly secretBox: SecretBox
  readonly sesEvents: SesEventProcessor
  /** Organization-configured hosts (webhooks, SMTP, S3) never reach internal networks. */
  readonly outboundPolicy: OutboundTargetPolicy
  readonly outboundHttp: OutboundHttpClient
  /** Public base URL used in recipient-facing links. */
  readonly appUrl: string
  /** Environment defaults every organization's settings are merged over. */
  readonly defaultSettings: SettingsMap
  /** Test seams. */
  readonly providerOverrides?: ProviderOverrides
  readonly webhookOverride?: WebhookDispatcher
}

/**
 * Every tenant service of ONE organization, built lazily and wired through
 * constructors with the organization's TenantScope first. Obtained from
 * `Container.forOrganization(organizationId)` (cached) — never constructed by
 * routes. Infrastructure (db, jobs, renderer, tokens) is shared with the root.
 */
export class OrganizationContainer {
  private settingsInstance?: SettingsService
  private providersInstance?: ProviderRegistry
  private auditInstance?: AuditLogger
  private limitsInstance?: LimitService
  private suppressionsInstance?: SuppressionService
  private webhookServiceInstance?: WebhookService
  private senderInstance?: MessageSender
  private senderPolicyInstance?: SenderPolicy
  private systemMailInstance?: SystemMail
  private linksInstance?: LinkBuilder
  private contactsInstance?: ContactService
  private importsInstance?: ImportService
  private listsInstance?: ListService
  private topicsInstance?: TopicService
  private segmentBuilderInstance?: SegmentQueryBuilder
  private segmentsInstance?: SegmentService
  private audienceInstance?: AudienceResolver
  private templatesInstance?: TemplateService
  private filesInstance?: FileService
  private broadcastsInstance?: BroadcastService
  private transactionalInstance?: TransactionalService
  private optInInstance?: OptInService
  private preferencesInstance?: PreferenceService
  private analyticsInstance?: AnalyticsService
  private logsInstance?: LogService
  private apiLogsInstance?: ApiLogService
  private domainsInstance?: DomainService
  private diagnosticsInstance?: SettingsDiagnostics
  private webhookAdminInstance?: WebhookAdmin
  private suppressionAdminInstance?: SuppressionAdmin
  private sesSimulatorInstance?: SesEventSimulator
  private sesEventApplierInstance?: SesEventApplier
  private inboundEventsInstance?: InboundEventReader
  private contactApiInstance?: ContactApi
  private listApiInstance?: ListApi
  private broadcastApiInstance?: BroadcastApi
  private templateApiInstance?: TemplateApi
  private publicSignupInstance?: PublicSignup
  private publicBrandInstance?: PublicBrandReader
  private webViewInstance?: WebViewRenderer
  private messagePreviewInstance?: MessagePreview
  private templatePreviewerInstance?: TemplatePreviewer
  private templateTestSenderInstance?: TemplateTestSender
  private membersInstance?: MemberService
  private invitationsInstance?: InvitationService
  private profileInstance?: OrganizationProfile

  constructor(
    readonly scope: TenantScope,
    private readonly platform: PlatformInfrastructure
  ) {}

  get organizationId(): string {
    return this.scope.organizationId
  }

  /**
   * Raw database access bypasses tenant isolation: services only. Kept (private)
   * so legacy routes keep working at runtime until they move to a service.
   */
  private get db(): Database {
    return this.platform.db
  }

  get jobs(): JobLauncher {
    return this.platform.jobs
  }

  get renderer(): TemplateRenderer {
    return this.platform.renderer
  }

  get tokens(): TokenService {
    return this.platform.tokens
  }

  // Configuration & infrastructure --------------------------------------------
  get settings(): SettingsService {
    return (this.settingsInstance ??= new SettingsService(
      this.scope,
      this.db,
      this.platform.secretBox,
      this.platform.defaultSettings,
      this.platform.outboundPolicy
    ))
  }

  get providers(): ProviderRegistry {
    return (this.providersInstance ??= new ProviderRegistry(
      this.settings,
      this.platform.outboundPolicy,
      this.platform.providerOverrides
    ))
  }

  get audit(): AuditLogger {
    return (this.auditInstance ??= new AuditLogger(this.scope, this.db))
  }

  get limits(): LimitService {
    return (this.limitsInstance ??= new LimitService(this.scope, this.db, this.settings))
  }

  get links(): LinkBuilder {
    return (this.linksInstance ??= new LinkBuilder(
      this.scope,
      this.platform.appUrl,
      this.platform.tokens
    ))
  }

  // Messaging core -------------------------------------------------------------
  get webhookService(): WebhookService {
    return (this.webhookServiceInstance ??= new WebhookService(
      this.scope,
      this.db,
      this.jobs,
      this.platform.outboundHttp,
      this.platform.outboundPolicy
    ))
  }

  get webhooks(): WebhookDispatcher {
    return this.platform.webhookOverride ?? this.webhookService
  }

  get suppressions(): SuppressionService {
    return (this.suppressionsInstance ??= new SuppressionService(this.scope, this.db))
  }

  get sender(): MessageSender {
    return (this.senderInstance ??= new MessageSender(
      this.scope,
      this.db,
      this.providers,
      this.suppressions,
      this.webhooks,
      this.senderPolicy
    ))
  }

  /** From addresses the organization may send with (its own identities on the shared SES account). */
  get senderPolicy(): SenderPolicy {
    return (this.senderPolicyInstance ??= new SenderPolicy(this.settings, this.domains))
  }

  get systemMail(): SystemMail {
    return (this.systemMailInstance ??= new SystemMail(
      this.scope,
      this.db,
      this.settings,
      this.sender,
      this.renderer
    ))
  }

  // Audience -------------------------------------------------------------------
  get contacts(): ContactService {
    return (this.contactsInstance ??= new ContactService(
      this.scope,
      this.db,
      this.audit,
      this.limits,
      this.webhooks,
      this.jobs,
      this.suppressions
    ))
  }

  get imports(): ImportService {
    return (this.importsInstance ??= new ImportService(
      this.scope,
      this.db,
      this.contacts,
      this.limits,
      this.audit,
      this.jobs
    ))
  }

  get lists(): ListService {
    return (this.listsInstance ??= new ListService(this.scope, this.db, this.audit, this.limits))
  }

  get topics(): TopicService {
    return (this.topicsInstance ??= new TopicService(this.scope, this.db, this.audit))
  }

  get segmentBuilder(): SegmentQueryBuilder {
    return (this.segmentBuilderInstance ??= new SegmentQueryBuilder())
  }

  get segments(): SegmentService {
    return (this.segmentsInstance ??= new SegmentService(
      this.scope,
      this.db,
      this.audit,
      this.limits,
      this.segmentBuilder
    ))
  }

  get audience(): AudienceResolver {
    return (this.audienceInstance ??= new AudienceResolver(
      this.scope,
      this.db,
      this.segmentBuilder
    ))
  }

  // Content --------------------------------------------------------------------
  get templates(): TemplateService {
    return (this.templatesInstance ??= new TemplateService(
      this.scope,
      this.db,
      this.renderer,
      this.audit,
      this.limits
    ))
  }

  get files(): FileService {
    return (this.filesInstance ??= new FileService(
      this.scope,
      this.db,
      this.providers,
      this.limits,
      this.audit
    ))
  }

  get templatePreviewer(): TemplatePreviewer {
    return (this.templatePreviewerInstance ??= new TemplatePreviewer(
      this.scope,
      this.renderer,
      this.settings,
      this.links.baseUrl
    ))
  }

  get templateTestSender(): TemplateTestSender {
    return (this.templateTestSenderInstance ??= new TemplateTestSender(
      this.scope,
      this.db,
      this.templates,
      this.renderer,
      this.templatePreviewer,
      this.sender,
      this.settings,
      this.limits,
      this.audit
    ))
  }

  // Sending --------------------------------------------------------------------
  get broadcasts(): BroadcastService {
    return (this.broadcastsInstance ??= new BroadcastService(
      this.scope,
      this.db,
      this.audience,
      this.templates,
      this.renderer,
      this.sender,
      this.links,
      this.settings,
      this.limits,
      this.audit,
      this.jobs,
      this.webhooks
    ))
  }

  get transactional(): TransactionalService {
    return (this.transactionalInstance ??= new TransactionalService(
      this.scope,
      this.db,
      this.templates,
      this.renderer,
      this.sender,
      this.links,
      this.settings,
      this.limits,
      this.contacts,
      this.jobs,
      { audit: this.audit, topics: this.topics, webhooks: this.webhooks }
    ))
  }

  get optIn(): OptInService {
    return (this.optInInstance ??= new OptInService(
      this.scope,
      this.db,
      this.contacts,
      this.renderer,
      this.sender,
      this.links,
      this.settings,
      this.jobs,
      this.tokens,
      this.audit,
      this.publicBrand
    ))
  }

  get preferences(): PreferenceService {
    return (this.preferencesInstance ??= new PreferenceService(
      this.scope,
      this.db,
      this.tokens,
      this.contacts,
      this.topics,
      this.audit,
      this.suppressions,
      this.publicBrand
    ))
  }

  /** Branding of this organization on recipient pages (embedded in every public payload). */
  get publicBrand(): PublicBrandReader {
    return (this.publicBrandInstance ??= new PublicBrandReader(this.scope, this.db, this.settings))
  }

  get publicSignup(): PublicSignup {
    return (this.publicSignupInstance ??= new PublicSignup(
      this.scope,
      this.db,
      this.contacts,
      this.publicBrand
    ))
  }

  get webView(): WebViewRenderer {
    return (this.webViewInstance ??= new WebViewRenderer(
      this.scope,
      this.db,
      this.tokens,
      this.renderer,
      this.links,
      this.settings,
      this.contacts
    ))
  }

  // Observability & administration -------------------------------------------
  get analytics(): AnalyticsService {
    return (this.analyticsInstance ??= new AnalyticsService(this.scope, this.db))
  }

  get logs(): LogService {
    return (this.logsInstance ??= new LogService(this.scope, this.db))
  }

  get apiLogs(): ApiLogService {
    return (this.apiLogsInstance ??= new ApiLogService(this.scope, this.db))
  }

  get messagePreview(): MessagePreview {
    return (this.messagePreviewInstance ??= new MessagePreview(
      this.scope,
      this.renderer,
      this.settings
    ))
  }

  get domains(): DomainService {
    return (this.domainsInstance ??= new DomainService(this.scope, this.providers, this.settings))
  }

  get diagnostics(): SettingsDiagnostics {
    return (this.diagnosticsInstance ??= new SettingsDiagnostics(
      this.scope,
      this.settings,
      this.providers,
      this.systemMail,
      this.audit
    ))
  }

  get webhookAdmin(): WebhookAdmin {
    return (this.webhookAdminInstance ??= new WebhookAdmin(
      this.scope,
      this.db,
      this.webhookService,
      this.audit
    ))
  }

  get suppressionAdmin(): SuppressionAdmin {
    return (this.suppressionAdminInstance ??= new SuppressionAdmin(
      this.scope,
      this.db,
      this.suppressions,
      this.audit
    ))
  }

  /** Applies SES events routed to this organization by the platform router (`Container.sesEvents`). */
  get sesEventApplier(): SesEventApplier {
    return (this.sesEventApplierInstance ??= new SesEventApplier(
      this.scope,
      this.settings,
      this.suppressions,
      this.webhooks
    ))
  }

  /** This organization's rows of the instance-wide inbound event log. */
  get inboundEvents(): InboundEventReader {
    return (this.inboundEventsInstance ??= new InboundEventReader(this.scope, this.db))
  }

  get sesSimulator(): SesEventSimulator {
    return (this.sesSimulatorInstance ??= new SesEventSimulator(
      this.scope,
      this.db,
      this.platform.sesEvents,
      this.audit
    ))
  }

  get contactApi(): ContactApi {
    return (this.contactApiInstance ??= new ContactApi(this.scope, this.db, this.contacts))
  }

  /** REST API v1 lists resource. */
  get listApi(): ListApi {
    return (this.listApiInstance ??= new ListApi(this.lists))
  }

  /** REST API v1 broadcasts resource. */
  get broadcastApi(): BroadcastApi {
    return (this.broadcastApiInstance ??= new BroadcastApi(this.broadcasts))
  }

  /** REST API v1 templates resource. */
  get templateApi(): TemplateApi {
    return (this.templateApiInstance ??= new TemplateApi(this.templates))
  }

  /** Members of this organization (role changes and removals go through Better Auth). */
  get members(): MemberService {
    return (this.membersInstance ??= new MemberService(this.scope, this.db, this.audit))
  }

  /** Pending invitations of this organization. */
  get invitations(): InvitationService {
    return (this.invitationsInstance ??= new InvitationService(
      this.scope,
      this.db,
      this.audit,
      this.links.baseUrl
    ))
  }

  /** Name, slug and logo of this organization. */
  get profile(): OrganizationProfile {
    return (this.profileInstance ??= new OrganizationProfile(this.scope, this.db))
  }

  /** API keys of this organization, issued through Better Auth on behalf of the signed-in member. */
  apiKeys(issuer: ApiKeyIssuer): ApiKeyService {
    return new ApiKeyService(this.scope, this.db, this.audit, issuer)
  }

  /** Releases provider connections (called when the container leaves the cache). */
  dispose(): void {
    this.providersInstance?.dispose()
  }
}
