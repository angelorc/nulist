import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { emailEvents, messages } from '../../db/schema'
import type {
  TransactionalBatchSendResult,
  TransactionalEmail,
  TransactionalEmailDetail,
  TransactionalEmailInput,
  TransactionalOverview,
  TransactionalSendInput,
  TransactionalSendResult
} from '../../../shared/schemas/transactional'
import type { V1EmailListQuery, V1Page } from '../../../shared/schemas/v1'
import type { MessageStatus } from '../../../shared/types/domain'
import type { ApiKeyIdentity } from '../api/ApiKeyVerifier'
import { V1Presenter } from '../api/V1Presenter'
import type { AuditLogger } from '../audit/AuditLogger'
import type { ContactService } from '../contacts/ContactService'
import type { Actor } from '../core/actor'
import { ConflictError, DomainError, InvalidStateError, NotFoundError } from '../core/errors'
import type { JobLauncher } from '../core/jobs'
import type { MessageSender } from '../email/MessageSender'
import type { LimitService } from '../limits/LimitService'
import type { TopicService } from '../lists/TopicService'
import type { LinkBuilder } from '../security/LinkBuilder'
import type { SettingsService } from '../settings/SettingsService'
import type { TemplateRenderer } from '../templates/TemplateRenderer'
import type { TemplateService } from '../templates/TemplateService'
import type { WebhookDispatcher } from '../webhooks/WebhookDispatcher'
import { IdempotencyStore, isIdempotencyViolation } from './IdempotencyStore'
import type { MessageRow } from './IdempotencyStore'
import { RequestFingerprint } from './RequestFingerprint'
import { TransactionalComposer } from './TransactionalComposer'
import type { ComposedEmail } from './TransactionalComposer'
import { TransactionalEmailList } from './TransactionalEmailList'
import { TransactionalOverviewQuery } from './TransactionalOverviewQuery'
import { TransactionalPresenter } from './TransactionalPresenter'
import type { TenantScope } from '../core/TenantScope'

/** The organization container's audit log, topics and webhook dispatcher. */
export interface TransactionalCollaborators {
  audit: AuditLogger
  topics: TopicService
  webhooks: WebhookDispatcher
}

/** `email.suppressed` payload when the recipient opted out of the email's topic. */
interface TopicOptOutEvent {
  id: string
  to: string
  reason: 'topic_opt_out'
  topicId: string
  broadcastId: null
}

/** What the workflow should do with a message (plain data: crosses the step boundary). */
export interface DeliveryPlan {
  action: 'deliver' | 'skip'
  status: MessageStatus
  /** Milliseconds to wait before delivering (scheduled emails). */
  delayMs: number
}

export interface DeliveryResult {
  messageId: string
  status: MessageStatus
  providerMessageId: string | null
  error: string | null
  /** True when nothing was attempted (already sent, cancelled…). */
  skipped: boolean
}

interface SendRequest {
  input: TransactionalEmailInput
  idempotencyKey: string | null
}

interface PlannedSend {
  /** Position in the request (batch index). */
  index: number
  request: SendRequest
  requestHash: string
  /** Earlier email with the same Idempotency-Key and payload. */
  replay: MessageRow | null
}

interface Draft {
  plan: PlannedSend
  composed: ComposedEmail
}

interface StoredDraft extends Draft {
  row: MessageRow
}

const DELIVERABLE: ReadonlySet<MessageStatus> = new Set<MessageStatus>([
  'queued',
  'sending',
  'scheduled'
])

const DAY_MS = 86_400_000

/**
 * Transactional email of one organization: one-to-one messages rendered from a
 * transactional template (or raw HTML) and delivered by the `sendTransactional`
 * workflow. Content is rendered when the request arrives and stored on the
 * message, so retries and scheduled sends deliver exactly what was accepted.
 * Every read and write is scoped to the organization: another organization's
 * email behaves as missing (404).
 */
export class TransactionalService {
  private readonly audit: AuditLogger
  private readonly topics: TopicService
  private readonly webhooks: WebhookDispatcher
  private readonly idempotency: IdempotencyStore
  private readonly overviewQuery: TransactionalOverviewQuery
  private readonly emailList: TransactionalEmailList

  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    protected readonly templates: TemplateService,
    protected readonly renderer: TemplateRenderer,
    protected readonly sender: MessageSender,
    protected readonly links: LinkBuilder,
    protected readonly settings: SettingsService,
    protected readonly limits: LimitService,
    protected readonly contacts: ContactService,
    protected readonly jobs: JobLauncher,
    collaborators: TransactionalCollaborators
  ) {
    this.audit = collaborators.audit
    this.topics = collaborators.topics
    this.webhooks = collaborators.webhooks
    this.idempotency = new IdempotencyStore(scope, db)
    this.overviewQuery = new TransactionalOverviewQuery(scope, db)
    this.emailList = new TransactionalEmailList(scope, db)
  }

  /** `messages.id = id` inside this organization. */
  private messageById(id: string) {
    return and(this.scope.eq(messages.organizationId), eq(messages.id, id))
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  /**
   * Queues one email. With an Idempotency-Key, a retry with the same payload
   * returns the original email (`replayed`), a different payload is a 409.
   */
  async send(
    input: TransactionalSendInput,
    apiKey: ApiKeyIdentity | null
  ): Promise<TransactionalSendResult> {
    const { idempotencyKey, ...email } = input

    const [result] = await this.sendMany(
      [{ input: email, idempotencyKey: idempotencyKey ?? null }],
      apiKey
    )

    if (!result) throw new DomainError('The email could not be queued', 500, 'internal_error')

    return result
  }

  /**
   * Queues up to 100 emails. Everything is validated and rendered first, then
   * stored in one transaction: either every email is accepted or none is.
   * An Idempotency-Key applies to the whole batch (`key:index` per email).
   */
  async sendBatch(
    inputs: TransactionalEmailInput[],
    apiKey: ApiKeyIdentity | null,
    idempotencyKey?: string | null
  ): Promise<TransactionalBatchSendResult> {
    const requests = inputs.map((input, index) => ({
      input,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:${index}` : null
    }))

    const results = await this.sendMany(requests, apiKey)

    return {
      batch: { object: 'list', data: results.map((r) => r.email) },
      replayed: results.length > 0 && results.every((r) => r.replayed)
    }
  }

  private async sendMany(
    requests: SendRequest[],
    apiKey: ApiKeyIdentity | null,
    retryOnRace = true
  ): Promise<TransactionalSendResult[]> {
    const apiKeyId = apiKey?.id ?? null

    const planned: PlannedSend[] = await Promise.all(
      requests.map(async (request, index) => {
        const requestHash = RequestFingerprint.of(request.input)

        const replay = request.idempotencyKey
          ? await this.idempotency.find(apiKeyId, request.idempotencyKey, requestHash)
          : null

        return { index, request, requestHash, replay }
      })
    )

    const fresh = planned.filter((p) => !p.replay)

    if (fresh.length) await this.limits.assertCanSend(fresh.length)

    const composer = new TransactionalComposer(
      {
        scope: this.scope,
        templates: this.templates,
        renderer: this.renderer,
        links: this.links,
        contacts: this.contacts,
        topics: this.topics,
        senders: this.sender.senders
      },
      await this.settings.get('general')
    )

    const drafts: Draft[] = []

    for (const plan of fresh) {
      try {
        drafts.push({ plan, composed: await composer.compose(plan.request.input) })
      } catch (cause) {
        if (requests.length > 1 && cause instanceof DomainError)
          throw TransactionalService.atIndex(cause, plan.index)
        throw cause
      }
    }

    let stored: StoredDraft[]

    try {
      stored = await this.insert(drafts, apiKeyId)
    } catch (cause) {
      if (!isIdempotencyViolation(cause)) throw cause

      // A concurrent request with the same Idempotency-Key won the race: resolve against it.
      if (retryOnRace) return this.sendMany(requests, apiKey, false)
      throw new ConflictError(
        'A request with this Idempotency-Key is still being processed. Retry shortly.',
        'concurrent_idempotent_request'
      )
    }

    const results = new Map<number, TransactionalSendResult>()

    for (const plan of planned) {
      if (plan.replay)
        results.set(plan.index, {
          email: TransactionalPresenter.email(plan.replay),
          replayed: true
        })
    }

    for (const draft of stored) {
      results.set(draft.plan.index, {
        email: TransactionalPresenter.email(await this.dispatch(draft.row, draft.composed)),
        replayed: false
      })
    }

    return planned.flatMap((p) => results.get(p.index) ?? [])
  }

  /** Stores every draft in one transaction (all or nothing). */
  private async insert(drafts: Draft[], apiKeyId: string | null): Promise<StoredDraft[]> {
    if (!drafts.length) return []

    return this.db.transaction(async (tx) => {
      const stored: StoredDraft[] = []

      for (const draft of drafts) {
        const [row] = await tx
          .insert(messages)
          .values(
            this.scope.values({
              ...draft.composed.values,
              apiKeyId,
              idempotencyKey: draft.plan.request.idempotencyKey,
              requestHash: draft.plan.requestHash
            })
          )
          .returning()

        if (!row) throw new DomainError('The email could not be stored', 500, 'internal_error')
        stored.push({ ...draft, row })
      }

      return stored
    })
  }

  /** Starts delivery, or announces the topic opt-out. Launch failures mark the email failed. */
  private async dispatch(row: MessageRow, composed: ComposedEmail): Promise<MessageRow> {
    if (composed.optOut) {
      await this.notify('email.suppressed', {
        id: row.id,
        to: row.toEmail,
        reason: 'topic_opt_out',
        topicId: composed.optOut.topicId,
        broadcastId: null
      })

      return row
    }

    try {
      const runId = await this.jobs.sendTransactional(this.scope.organizationId, row.id)

      const [updated] = await this.db
        .update(messages)
        .set({ runId })
        .where(this.messageById(row.id))
        .returning()

      return updated ?? row
    } catch (cause) {
      console.error('[transactional] could not start delivery', row.id, cause)
      await this.sender.markFailed(row.id, 'Delivery could not be started. Try again later.')

      return (await this.find(row.id)) ?? row
    }
  }

  /** The error of one batch item, prefixed with its position. */
  private static atIndex(error: DomainError, index: number): DomainError {
    return new DomainError(`emails[${index}]: ${error.message}`, error.status, error.code, {
      ...error.data,
      index
    })
  }

  private async notify(type: 'email.suppressed', data: TopicOptOutEvent): Promise<void> {
    try {
      await this.webhooks.dispatch(type, data)
    } catch (cause) {
      console.error(`[transactional] failed to dispatch ${type} webhook`, cause)
    }
  }

  // ---------------------------------------------------------------------------
  // Reading and cancelling
  // ---------------------------------------------------------------------------

  private async find(id: string): Promise<MessageRow | null> {
    const [row] = await this.db
      .select()
      .from(messages)
      .where(and(this.messageById(id), eq(messages.kind, 'transactional')))

    return row ?? null
  }

  private async findOrFail(id: string): Promise<MessageRow> {
    const row = await this.find(id)

    if (!row) throw new NotFoundError('Email', id)

    return row
  }

  /** The organization's transactional emails, newest first (REST API v1 `GET /emails`). */
  async list(query: V1EmailListQuery): Promise<V1Page<TransactionalEmail>> {
    const page = await this.emailList.page(query)

    return V1Presenter.page(page, (row) => TransactionalPresenter.email(row))
  }

  async get(id: string): Promise<TransactionalEmailDetail> {
    const row = await this.findOrFail(id)

    const events = await this.db
      .select({
        type: emailEvents.type,
        occurredAt: emailEvents.occurredAt,
        data: emailEvents.data
      })
      .from(emailEvents)
      .where(and(this.scope.eq(emailEvents.organizationId), eq(emailEvents.messageId, id)))
      .orderBy(asc(emailEvents.occurredAt), asc(emailEvents.id))

    return TransactionalPresenter.detail(row, events)
  }

  /** Cancels a scheduled email (the workflow re-checks the status before sending). */
  async cancel(id: string, actor: Actor): Promise<TransactionalEmail> {
    const [row] = await this.db
      .update(messages)
      .set({ status: 'cancelled', error: `Cancelled by ${actor.label}` })
      .where(
        and(
          this.messageById(id),
          eq(messages.kind, 'transactional'),
          eq(messages.status, 'scheduled')
        )
      )
      .returning()

    if (!row) {
      const current = await this.findOrFail(id)
      throw new InvalidStateError(
        `Only scheduled emails can be cancelled; this email is ${current.status}.`
      )
    }

    if (row.runId) {
      try {
        await this.jobs.cancel(row.runId)
      } catch (cause) {
        // The workflow sees the cancelled status when it wakes up.
        console.warn('[transactional] could not cancel workflow run', row.runId, cause)
      }
    }

    await this.audit.log(actor, {
      action: 'email.cancelled',
      entityType: 'email',
      entityId: id,
      summary: `Cancelled the scheduled email to ${row.toEmail}`,
      changes: { subject: row.subject, scheduledAt: row.scheduledAt?.toISOString() ?? null }
    })

    return TransactionalPresenter.email(row)
  }

  /** Dashboard data. API traffic is added by the endpoint (ApiLogService). */
  async overview(now = new Date()): Promise<Omit<TransactionalOverview, 'api'>> {
    const t = now.getTime()

    const [last24h, previous24h, last7d, recent, templates] = await Promise.all([
      this.overviewQuery.window(new Date(t - DAY_MS), now),
      this.overviewQuery.window(new Date(t - 2 * DAY_MS), new Date(t - DAY_MS)),
      this.overviewQuery.window(new Date(t - 7 * DAY_MS), now),
      this.overviewQuery.recent(10),
      this.overviewQuery.templates(now)
    ])

    return { last24h, previous24h, last7d, recent, templates }
  }

  // ---------------------------------------------------------------------------
  // Workflow steps (plain data in and out)
  // ---------------------------------------------------------------------------

  async plan(messageId: string, now = Date.now()): Promise<DeliveryPlan> {
    const row = await this.findOrFail(messageId)

    if (!DELIVERABLE.has(row.status)) return { action: 'skip', status: row.status, delayMs: 0 }

    const delayMs =
      row.status === 'scheduled' && row.scheduledAt
        ? Math.max(0, row.scheduledAt.getTime() - now)
        : 0

    return { action: 'deliver', status: row.status, delayMs }
  }

  /** Hands the stored content to the provider. Retryable provider errors propagate (ProviderError). */
  async deliver(messageId: string): Promise<DeliveryResult> {
    let row = await this.findOrFail(messageId)

    if (row.status === 'scheduled') {
      const [released] = await this.db
        .update(messages)
        .set({ status: 'queued' })
        .where(and(this.messageById(messageId), eq(messages.status, 'scheduled')))
        .returning()

      row = released ?? (await this.findOrFail(messageId))
    }

    if (!['queued', 'sending'].includes(row.status)) return this.result(row, true)

    // The limits may have been lowered, or used up by concurrent sends, since the email was accepted.
    if ((await this.limits.remainingDeliveryCapacity()) < 1) {
      await this.sender.markFailed(
        messageId,
        'Not sent: the daily or monthly sending limit of the organization is used up.'
      )

      return this.result(await this.findOrFail(messageId), false)
    }

    const outcome = await this.sender.deliver({
      messageId,
      content: { subject: row.subject, html: row.html ?? '', text: row.text ?? '' }
    })

    const after = await this.findOrFail(messageId)

    return {
      ...this.result(after, false),
      providerMessageId: outcome.status === 'sent' ? outcome.providerMessageId : null,
      error:
        outcome.status === 'failed'
          ? outcome.error
          : outcome.status === 'suppressed'
            ? `Suppressed: ${outcome.reason}`
            : null
    }
  }

  /** Called when every delivery attempt failed. No-op once the email left the deliverable states. */
  async fail(messageId: string, error: string): Promise<DeliveryResult> {
    const row = await this.findOrFail(messageId)

    if (!DELIVERABLE.has(row.status)) return this.result(row, true)
    await this.sender.markFailed(messageId, error.slice(0, 1_000))

    return this.result(await this.findOrFail(messageId), false)
  }

  private result(row: MessageRow, skipped: boolean): DeliveryResult {
    return {
      messageId: row.id,
      status: row.status,
      providerMessageId: row.providerMessageId,
      error: row.error,
      skipped
    }
  }
}
