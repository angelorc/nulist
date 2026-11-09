import { and, count, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import type { Database } from '../../db/client'
import { auditLogs, broadcasts, contacts, messages, templates, topics } from '../../db/schema'
import {
  EMPTY_AUDIENCE,
  campaignSlug,
  hasAudienceSources
} from '../../../shared/schemas/broadcasts'
import type {
  BroadcastCreateInput,
  BroadcastListQuery,
  BroadcastRecipientsQuery,
  BroadcastUpdateInput
} from '../../../shared/schemas/broadcasts'
import type {
  BroadcastBatchResult,
  BroadcastBeginResult,
  BroadcastBeginState,
  BroadcastCompletion,
  BroadcastPreflight,
  BroadcastPreview,
  BroadcastProgress,
  BroadcastSendPlan,
  BroadcastTabCounts,
  BroadcastTestResult,
  ChecklistItem
} from '../../../shared/types/broadcasts'
import type {
  AudienceDefinition,
  BroadcastStatus,
  Paginated,
  UtmSettings
} from '../../../shared/types/domain'
import {
  UNSENT_ENDED_BROADCAST_STATUSES,
  isBroadcastDeletable
} from '../../../shared/utils/broadcasts'
import type { AuditLogger } from '../audit/AuditLogger'
import { SYSTEM_ACTOR } from '../core/actor'
import type { Actor } from '../core/actor'
import { DomainError, InvalidStateError, NotFoundError, ValidationError } from '../core/errors'
import type { JobLauncher } from '../core/jobs'
import type { MessageSender } from '../email/MessageSender'
import type { LimitService } from '../limits/LimitService'
import type { AudienceResolver } from '../segments/AudienceResolver'
import type { LinkBuilder } from '../security/LinkBuilder'
import type { SettingsService } from '../settings/SettingsService'
import type { TemplateRenderer } from '../templates/TemplateRenderer'
import type { TemplateService } from '../templates/TemplateService'
import type { WebhookDispatcher } from '../webhooks/WebhookDispatcher'
import { BroadcastAudience } from './BroadcastAudience'
import { BroadcastBatchSender } from './BroadcastBatchSender'
import { BroadcastContent, DEFAULT_UTM_MEDIUM, DEFAULT_UTM_SOURCE } from './BroadcastContent'
import { BroadcastPreflightCheck, TEST_SENT_ACTION } from './BroadcastPreflight'
import { BroadcastQueries } from './BroadcastQueries'
import type { BroadcastListRow, BroadcastRecipientRow } from './BroadcastQueries'
import { BroadcastTestSender } from './BroadcastTestSender'
import type { TenantScope } from '../core/TenantScope'

export type BroadcastRow = typeof broadcasts.$inferSelect

/** Detail projection: the row without its (large) HTML snapshot, plus related summaries. */
export interface BroadcastDetailRow extends Omit<
  BroadcastRow,
  'htmlSnapshot' | 'createdById' | 'organizationId'
> {
  template: {
    id: string
    name: string
    kind: 'marketing' | 'transactional'
    updatedAt: Date
  } | null
  topic: { id: string; name: string } | null
  progress: BroadcastProgress
  lastTestAt: Date | null
  defaultCampaign: string
}

/** States in which the broadcast is (or is about to be) delivered by a workflow run. */
const ACTIVE_STATUSES: BroadcastStatus[] = ['scheduled', 'sending', 'paused']

/** Ended states: once sending started, the broadcast's messages (and its row) are kept. */
const ENDED_STATUSES: ReadonlySet<BroadcastStatus> = new Set(['sent', 'cancelled', 'failed'])

/** `isBroadcastDeletable` as a `where` clause, so a delete racing a send start removes nothing. */
const DELETABLE_CONDITION = or(
  eq(broadcasts.status, 'draft'),
  and(
    inArray(broadcasts.status, [...UNSENT_ENDED_BROADCAST_STATUSES]),
    isNull(broadcasts.startedAt)
  )
)

/** Fields a draft edit can change (compared for the audit entry). */
const EDITABLE_FIELDS = [
  'name',
  'subject',
  'preheader',
  'fromName',
  'fromEmail',
  'replyTo',
  'templateId',
  'topicId',
  'audience',
  'utm'
] as const satisfies readonly (keyof BroadcastRow)[]

/** Draft edits by the same person within this window share one audit entry (autosave). */
const AUDIT_COALESCE_MS = 10 * 60_000
const MAX_SCHEDULE_AHEAD_MS = 366 * 86_400_000

const DEFAULT_UTM: UtmSettings = {
  enabled: false,
  source: DEFAULT_UTM_SOURCE,
  medium: DEFAULT_UTM_MEDIUM,
  campaign: ''
}

const BEGIN_STATE: Record<BroadcastStatus, BroadcastBeginState> = {
  draft: 'cancelled',
  scheduled: 'sending',
  sending: 'sending',
  paused: 'paused',
  cancelled: 'cancelled',
  sent: 'finished',
  failed: 'finished'
}

const numberFmt = new Intl.NumberFormat('en-US')

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * Broadcasts (campaigns): draft composition, pre-flight checks, scheduling and
 * the state machine driven by the `sendBroadcastWorkflow` durable run.
 *
 * draft → scheduled → sending ⇄ paused → sent
 *                 ↘ cancelled / failed
 *
 * Works inside one organization: every query is scoped by `scope`, ids of
 * another organization behave as missing (404), and the injected services
 * (audience, templates, sender, settings, limits, audit, webhooks) are the
 * organization's own.
 */
export class BroadcastService {
  private readonly recipientsAudience: BroadcastAudience
  private readonly content: BroadcastContent
  private readonly preflightCheck: BroadcastPreflightCheck
  private readonly queries: BroadcastQueries
  private readonly batchSender: BroadcastBatchSender
  private readonly testSender: BroadcastTestSender

  constructor(
    protected readonly scope: TenantScope,
    protected readonly db: Database,
    protected readonly audience: AudienceResolver,
    protected readonly templateService: TemplateService,
    protected readonly renderer: TemplateRenderer,
    protected readonly sender: MessageSender,
    protected readonly links: LinkBuilder,
    protected readonly settings: SettingsService,
    protected readonly limits: LimitService,
    protected readonly audit: AuditLogger,
    protected readonly jobs: JobLauncher,
    protected readonly webhooks: WebhookDispatcher
  ) {
    this.recipientsAudience = new BroadcastAudience(scope, db, audience)
    this.content = new BroadcastContent(renderer, links, settings)
    this.preflightCheck = new BroadcastPreflightCheck(
      scope,
      db,
      this.recipientsAudience,
      templateService,
      renderer,
      settings,
      limits,
      sender.senders
    )
    this.queries = new BroadcastQueries(scope, db)
    this.batchSender = new BroadcastBatchSender(
      scope,
      db,
      this.content,
      sender,
      limits,
      settings,
      webhooks,
      this.recipientsAudience
    )
    this.testSender = new BroadcastTestSender(
      scope,
      db,
      templateService,
      this.content,
      sender,
      limits
    )
  }

  /** Hook token the paused workflow waits on (see server/workflows/broadcast.ts). */
  static resumeToken(broadcastId: string): string {
    return `broadcast:${broadcastId}:resume`
  }

  // Queries ------------------------------------------------------------------

  async list(query: BroadcastListQuery): Promise<Paginated<BroadcastListRow>> {
    return this.queries.list(query)
  }

  async tabCounts(): Promise<BroadcastTabCounts> {
    return this.queries.tabCounts()
  }

  async findOrFail(id: string): Promise<BroadcastRow> {
    const [row] = await this.db.select().from(broadcasts).where(this.byId(id))

    if (!row) throw new NotFoundError('Broadcast', id)

    return row
  }

  async get(id: string): Promise<BroadcastDetailRow> {
    const [row] = await this.db
      .select({
        broadcast: broadcasts,
        template: {
          id: templates.id,
          name: templates.name,
          kind: templates.kind,
          updatedAt: templates.updatedAt
        },
        topic: { id: topics.id, name: topics.name }
      })
      .from(broadcasts)
      .leftJoin(
        templates,
        and(eq(templates.id, broadcasts.templateId), this.scope.eq(templates.organizationId))
      )
      .leftJoin(
        topics,
        and(eq(topics.id, broadcasts.topicId), this.scope.eq(topics.organizationId))
      )
      .where(this.byId(id))

    if (!row) throw new NotFoundError('Broadcast', id)

    const [progress, lastTestAt] = await Promise.all([
      this.queries.progress(id),
      this.preflightCheck.lastTest(id)
    ])

    const {
      htmlSnapshot: _html,
      createdById: _by,
      organizationId: _organization,
      ...broadcast
    } = row.broadcast

    return {
      ...broadcast,
      template: row.template,
      topic: row.topic,
      progress,
      lastTestAt,
      defaultCampaign: campaignSlug(broadcast.name)
    }
  }

  async progress(id: string): Promise<BroadcastProgress> {
    await this.findOrFail(id)

    return this.queries.progress(id)
  }

  async recipients(
    id: string,
    query: BroadcastRecipientsQuery
  ): Promise<Paginated<BroadcastRecipientRow>> {
    await this.findOrFail(id)

    return this.queries.recipients(id, query)
  }

  /** Live recipient count for an (unsaved) audience. */
  async estimate(audience: AudienceDefinition, topicId?: string | null): Promise<number> {
    if (!hasAudienceSources(audience)) return 0

    return this.recipientsAudience.count(audience, topicId)
  }

  async checklist(broadcast: BroadcastRow): Promise<ChecklistItem[]> {
    return (await this.preflightCheck.evaluate(broadcast)).items
  }

  async preflight(id: string): Promise<BroadcastPreflight> {
    return this.preflightCheck.evaluate(await this.findOrFail(id))
  }

  /**
   * The email rendered for a sample contact: the current template while composing,
   * the frozen snapshot once sending started.
   */
  async preview(id: string): Promise<BroadcastPreview> {
    const broadcast = await this.findOrFail(id)
    const issues: string[] = []
    let html: string | null = broadcast.htmlSnapshot

    if (!html || broadcast.status === 'draft' || broadcast.status === 'scheduled') {
      if (!broadcast.templateId)
        return {
          subject: broadcast.subject,
          html: '',
          issues: ['Choose a template to see a preview.']
        }

      try {
        html = await this.templateService.compiledHtml(
          await this.templateService.findOrFail(broadcast.templateId)
        )
      } catch (error) {
        return {
          subject: broadcast.subject,
          html: '',
          issues: [this.message(error, 'The template could not be compiled.')]
        }
      }
    }

    let subject = broadcast.subject

    try {
      this.renderer.assertLiquid(subject, 'subject')
    } catch (error) {
      issues.push(this.message(error, 'The subject has invalid variables.'))
      subject = ''
    }

    try {
      const prepared = await this.content.prepare({ ...broadcast, subject }, html)

      const rendered = await prepared.render(
        this.content.variables(
          this.content.sampleContact(),
          this.content.placeholderLinks(),
          await this.content.company()
        )
      )

      return {
        subject: subject ? rendered.subject : broadcast.subject,
        html: rendered.html,
        issues
      }
    } catch (error) {
      issues.push(this.message(error, 'The template could not be rendered.'))

      return { subject: broadcast.subject, html, issues }
    }
  }

  // Draft mutations ------------------------------------------------------------

  async create(input: BroadcastCreateInput, actor: Actor): Promise<BroadcastRow> {
    await this.assertReferences(input)
    const general = await this.settings.get('general')

    const [row] = await this.db
      .insert(broadcasts)
      .values(
        this.scope.values({
          name: input.name,
          subject: input.subject ?? '',
          preheader: input.preheader ?? null,
          fromName: input.fromName ?? (general.defaultFromName || null),
          fromEmail: input.fromEmail ?? (general.defaultFromEmail || null),
          replyTo: input.replyTo ?? (general.defaultReplyTo || null),
          templateId: input.templateId ?? null,
          topicId: input.topicId ?? null,
          audience: input.audience ?? { ...EMPTY_AUDIENCE },
          utm: { ...DEFAULT_UTM, ...input.utm },
          createdById: actor.type === 'user' ? actor.id : null
        })
      )
      .returning()

    if (!row) throw new DomainError('Could not create the broadcast', 500, 'internal_error')
    await this.audit.log(actor, {
      action: 'broadcast.created',
      entityType: 'broadcast',
      entityId: row.id,
      summary: `Created broadcast "${row.name}"`
    })

    return row
  }

  /** Autosaved by the composer: drafts only. */
  async update(id: string, input: BroadcastUpdateInput, actor: Actor): Promise<BroadcastRow> {
    const before = await this.findOrFail(id)
    this.assertDraft(before)
    await this.assertReferences(input, before.audience)

    const patch: Partial<typeof broadcasts.$inferInsert> = {}

    if (input.name !== undefined) patch.name = input.name

    if (input.subject !== undefined) patch.subject = input.subject

    if (input.preheader !== undefined) patch.preheader = input.preheader

    if (input.fromName !== undefined) patch.fromName = input.fromName

    if (input.fromEmail !== undefined) patch.fromEmail = input.fromEmail

    if (input.replyTo !== undefined) patch.replyTo = input.replyTo

    if (input.templateId !== undefined) patch.templateId = input.templateId

    if (input.topicId !== undefined) patch.topicId = input.topicId

    if (input.audience !== undefined) patch.audience = input.audience

    if (input.utm !== undefined) patch.utm = { ...DEFAULT_UTM, ...input.utm }

    if (!Object.keys(patch).length) return before

    const [row] = await this.db
      .update(broadcasts)
      .set(patch)
      .where(and(this.byId(id), eq(broadcasts.status, 'draft')))
      .returning()

    if (!row)
      throw new InvalidStateError('Only drafts can be edited. Unschedule the broadcast first.')

    const changed = EDITABLE_FIELDS.filter(
      (key) => patch[key] !== undefined && JSON.stringify(before[key]) !== JSON.stringify(row[key])
    )

    if (changed.length && !(await this.recentlyEdited(id, actor))) {
      await this.audit.log(actor, {
        action: 'broadcast.updated',
        entityType: 'broadcast',
        entityId: id,
        summary: `Edited broadcast "${row.name}"`,
        changes: { fields: changed }
      })
    }

    return row
  }

  async duplicate(id: string, actor: Actor): Promise<BroadcastRow> {
    const source = await this.findOrFail(id)

    const [row] = await this.db
      .insert(broadcasts)
      .values(
        this.scope.values({
          name: `${source.name} (copy)`.slice(0, 120),
          subject: source.subject,
          preheader: source.preheader,
          fromName: source.fromName,
          fromEmail: source.fromEmail,
          replyTo: source.replyTo,
          templateId: source.templateId,
          topicId: source.topicId,
          audience: source.audience,
          utm: source.utm,
          createdById: actor.type === 'user' ? actor.id : null
        })
      )
      .returning()

    if (!row) throw new DomainError('Could not duplicate the broadcast', 500, 'internal_error')
    await this.audit.log(actor, {
      action: 'broadcast.duplicated',
      entityType: 'broadcast',
      entityId: row.id,
      summary: `Duplicated broadcast "${source.name}" as "${row.name}"`,
      changes: { sourceId: source.id }
    })

    return row
  }

  /**
   * Drafts, and broadcasts cancelled (or failed) before sending started
   * (`isBroadcastDeletable`). A broadcast that sent anything keeps its messages:
   * they are its delivery history and count towards the send limits.
   */
  async delete(id: string, actor: Actor): Promise<void> {
    const broadcast = await this.findOrFail(id)

    if (!isBroadcastDeletable(broadcast)) {
      throw new InvalidStateError(
        ENDED_STATUSES.has(broadcast.status)
          ? `This ${broadcast.status} broadcast started sending, so its delivery history is kept. Only drafts and broadcasts cancelled before sending started can be deleted.`
          : `A ${broadcast.status} broadcast can't be deleted. Only drafts and broadcasts cancelled before sending started can be deleted (cancel a scheduled one first).`
      )
    }

    const deleted = await this.db
      .delete(broadcasts)
      .where(and(this.byId(id), DELETABLE_CONDITION))
      .returning({ id: broadcasts.id })

    if (!deleted.length)
      throw new InvalidStateError(
        'This broadcast changed state meanwhile and can no longer be deleted.'
      )
    await this.audit.log(actor, {
      action: 'broadcast.deleted',
      entityType: 'broadcast',
      entityId: id,
      summary: `Deleted ${broadcast.status} broadcast "${broadcast.name}"`
    })
  }

  async sendTest(id: string, emails: string[], actor: Actor): Promise<BroadcastTestResult> {
    const broadcast = await this.findOrFail(id)
    const results = await this.testSender.send(broadcast, emails)
    const delivered = results.filter((r) => r.status === 'sent').map((r) => r.email)
    await this.audit.log(actor, {
      action: delivered.length ? TEST_SENT_ACTION : 'broadcast.test_failed',
      entityType: 'broadcast',
      entityId: id,
      summary: delivered.length
        ? `Sent a test of "${broadcast.name}" to ${delivered.join(', ')}`
        : `Test of "${broadcast.name}" was not delivered`,
      changes: {
        results: results.map((r) => ({ email: r.email, status: r.status, messageId: r.messageId }))
      }
    })

    return { results }
  }

  // Lifecycle ----------------------------------------------------------------

  /** Schedules the broadcast (`scheduledAt` null = send now) and starts its workflow run. */
  async schedule(id: string, scheduledAt: Date | null, actor: Actor): Promise<BroadcastRow> {
    const broadcast = await this.findOrFail(id)
    this.assertDraft(broadcast)

    if (scheduledAt) {
      if (scheduledAt.getTime() < Date.now() - 60_000)
        throw new ValidationError('Pick a time in the future.', { field: 'scheduledAt' })

      if (scheduledAt.getTime() > Date.now() + MAX_SCHEDULE_AHEAD_MS)
        throw new ValidationError('Schedule at most one year ahead.', { field: 'scheduledAt' })
    }

    const preflight = await this.preflightCheck.evaluate(broadcast)
    const blockers = preflight.items.filter((i) => i.status === 'blocker')

    if (blockers.length) {
      const first = blockers[0]!
      throw new ValidationError(
        blockers.length === 1
          ? `${first.label}: ${first.detail}`
          : `Fix ${blockers.length} blocking issues before sending (${blockers.map((b) => b.label.toLowerCase()).join(', ')}).`,
        { blockers: blockers.map((b) => b.key) }
      )
    }

    const [scheduled] = await this.db
      .update(broadcasts)
      .set({
        status: 'scheduled',
        scheduledAt,
        startedAt: null,
        completedAt: null,
        runId: null,
        recipientCount: preflight.recipients
      })
      .where(and(this.byId(id), eq(broadcasts.status, 'draft')))
      .returning()

    if (!scheduled) throw new InvalidStateError('This broadcast is no longer a draft.')

    let runId: string

    try {
      runId = await this.jobs.sendBroadcast(this.scope.organizationId, id)
    } catch (error) {
      await this.db
        .update(broadcasts)
        .set({ status: 'draft' })
        .where(and(this.byId(id), eq(broadcasts.status, 'scheduled')))
      throw error
    }

    const [row] = await this.db.update(broadcasts).set({ runId }).where(this.byId(id)).returning()

    const audienceSize = `${numberFmt.format(preflight.recipients)} recipient${preflight.recipients === 1 ? '' : 's'}`
    await this.audit.log(actor, {
      action: 'broadcast.scheduled',
      entityType: 'broadcast',
      entityId: id,
      summary: scheduledAt
        ? `Scheduled broadcast "${broadcast.name}" for ${scheduledAt.toISOString()} (${audienceSize})`
        : `Started sending broadcast "${broadcast.name}" to ${audienceSize}`,
      changes: {
        scheduledAt: scheduledAt?.toISOString() ?? null,
        recipients: preflight.recipients,
        runId
      }
    })

    return row ?? scheduled
  }

  /** Back to draft before sending started. */
  async unschedule(id: string, actor: Actor): Promise<BroadcastRow> {
    const before = await this.findOrFail(id)

    const [row] = await this.db
      .update(broadcasts)
      .set({ status: 'draft', scheduledAt: null, runId: null, recipientCount: 0 })
      .where(and(this.byId(id), eq(broadcasts.status, 'scheduled')))
      .returning()

    if (!row) {
      throw new InvalidStateError(
        before.status === 'sending' || before.status === 'paused'
          ? 'Sending already started. Pause or cancel the broadcast instead.'
          : 'Only scheduled broadcasts can be unscheduled.'
      )
    }

    if (before.runId) await this.cancelRun(before.runId)
    await this.audit.log(actor, {
      action: 'broadcast.unscheduled',
      entityType: 'broadcast',
      entityId: id,
      summary: `Unscheduled broadcast "${row.name}"`
    })

    return row
  }

  async cancel(id: string, actor: Actor): Promise<BroadcastRow> {
    const before = await this.findOrFail(id)

    const [row] = await this.db
      .update(broadcasts)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(and(this.byId(id), inArray(broadcasts.status, ACTIVE_STATUSES)))
      .returning()

    if (!row) throw new InvalidStateError(`A ${before.status} broadcast can't be cancelled.`)

    const cancelled = await this.cancelPendingMessages(id, 'Broadcast cancelled')

    if (row.runId) await this.cancelRun(row.runId)
    await this.audit.log(actor, {
      action: 'broadcast.cancelled',
      entityType: 'broadcast',
      entityId: id,
      summary: `Cancelled broadcast "${row.name}"${cancelled ? ` (${numberFmt.format(cancelled)} emails not sent)` : ''}`,
      changes: { from: before.status, unsent: cancelled }
    })

    return row
  }

  async pause(id: string, actor: Actor): Promise<BroadcastRow> {
    const before = await this.findOrFail(id)

    const [row] = await this.db
      .update(broadcasts)
      .set({ status: 'paused' })
      .where(and(this.byId(id), eq(broadcasts.status, 'sending')))
      .returning()

    if (!row)
      throw new InvalidStateError(
        `Only a sending broadcast can be paused (this one is ${before.status}).`
      )
    await this.audit.log(actor, {
      action: 'broadcast.paused',
      entityType: 'broadcast',
      entityId: id,
      summary: `Paused broadcast "${row.name}"`
    })

    return row
  }

  async resume(id: string, actor: Actor): Promise<BroadcastRow> {
    const before = await this.findOrFail(id)

    const [row] = await this.db
      .update(broadcasts)
      .set({ status: 'sending' })
      .where(and(this.byId(id), eq(broadcasts.status, 'paused')))
      .returning()

    if (!row)
      throw new InvalidStateError(
        `Only a paused broadcast can be resumed (this one is ${before.status}).`
      )
    // The run may not be waiting yet (it checks the status before waiting), so a missing hook is fine.
    await this.jobs.resumeHook(BroadcastService.resumeToken(id), {
      resumedAt: new Date().toISOString()
    })
    await this.audit.log(actor, {
      action: 'broadcast.resumed',
      entityType: 'broadcast',
      entityId: id,
      summary: `Resumed broadcast "${row.name}"`
    })

    return row
  }

  // Workflow steps API (plain serializable results) ---------------------------

  async plan(id: string): Promise<BroadcastSendPlan> {
    const [broadcast, sending] = await Promise.all([
      this.findOrFail(id),
      this.settings.get('sending')
    ])

    const scheduledAt = broadcast.scheduledAt

    return {
      status: broadcast.status,
      sleepUntil:
        broadcast.status === 'scheduled' && scheduledAt && scheduledAt.getTime() > Date.now() + 1000
          ? scheduledAt.toISOString()
          : null,
      batchSize: clamp(Math.max(1, sending.ratePerSecond) * 20, 50, 1000)
    }
  }

  /**
   * Starts sending a scheduled broadcast: freezes the compiled HTML and queues one
   * message per recipient in a single idempotent INSERT … SELECT.
   */
  async begin(id: string): Promise<BroadcastBeginResult> {
    const broadcast = await this.findOrFail(id)

    if (broadcast.status !== 'scheduled')
      return { state: BEGIN_STATE[broadcast.status], recipients: broadcast.recipientCount }

    const from = BroadcastContent.sender(broadcast)

    if (!from) throw new ValidationError('The broadcast has no sender email address.')
    await this.sender.senders.assertAllowed(from, 'fromEmail')

    if (!broadcast.templateId) throw new ValidationError('The broadcast has no template.')
    const template = await this.templateService.findOrFail(broadcast.templateId)
    const html = await this.templateService.compiledHtml(template)
    this.renderer.assertLiquid(html, 'content')
    this.renderer.assertLiquid(broadcast.subject, 'subject')

    // The template may have been edited since the broadcast was scheduled.
    if (!this.renderer.inspect(html).hasUnsubscribeLink)
      throw new ValidationError(
        'The template has no unsubscribe link. Add {{ unsubscribe_url }} or {{ preferences_url }} to its footer.'
      )

    const recipients = await this.recipientsAudience.recipientIdsQuery(
      broadcast.audience,
      broadcast.topicId
    )

    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ status: broadcasts.status })
        .from(broadcasts)
        .where(this.byId(id))
        .for('update')

      if (!locked) throw new NotFoundError('Broadcast', id)

      if (locked.status !== 'scheduled')
        return { state: BEGIN_STATE[locked.status], recipients: broadcast.recipientCount }

      // Only the organization's contacts are queued, whatever the audience query returns.
      await tx.execute(sql`
        insert into ${messages} (organization_id, kind, broadcast_id, contact_id, template_id, topic_id, to_email, from_email, reply_to, subject, status)
        select ${this.scope.id}, 'broadcast', ${id}::uuid, c.id, ${template.id}::uuid, ${broadcast.topicId}::uuid, c.email, ${from}, ${broadcast.replyTo}, ${broadcast.subject}, 'queued'
        from ${contacts} c
        where ${this.scope.sql('c')} and c.id in (${recipients})
        on conflict (broadcast_id, contact_id) do nothing`)

      const [total] = await tx
        .select({ value: count() })
        .from(messages)
        .where(and(this.scope.eq(messages.organizationId), eq(messages.broadcastId, id)))

      const recipientCount = total?.value ?? 0

      await tx
        .update(broadcasts)
        .set({
          status: 'sending',
          startedAt: new Date(),
          htmlSnapshot: html,
          recipientCount
        })
        .where(this.byId(id))

      return { state: 'sending' as const, recipients: recipientCount }
    })
  }

  async sendBatch(id: string, size: number): Promise<BroadcastBatchResult> {
    const broadcast = await this.findOrFail(id)

    const idle: BroadcastBatchResult = {
      sent: 0,
      failed: 0,
      suppressed: 0,
      remaining: 0,
      state: 'continue'
    }

    switch (broadcast.status) {
      case 'sending':
        return this.batchSender.send(broadcast, size)
      case 'paused':
        return { ...idle, remaining: await this.batchSender.remaining(id), state: 'paused' }
      case 'sent':
        return { ...idle, state: 'done' }
      default:
        return { ...idle, state: 'cancelled' }
    }
  }

  async status(id: string): Promise<BroadcastStatus> {
    return (await this.findOrFail(id)).status
  }

  /** Marks the broadcast sent and notifies webhooks (idempotent). */
  async complete(id: string): Promise<BroadcastCompletion> {
    const [row] = await this.db
      .update(broadcasts)
      .set({ status: 'sent', completedAt: new Date() })
      .where(and(this.byId(id), inArray(broadcasts.status, ['sending', 'paused'])))
      .returning()

    const progress = await this.queries.progress(id)

    const summary = {
      recipients: progress.recipients,
      sent: progress.sent,
      failed: progress.failed,
      suppressed: progress.suppressed
    }

    if (!row) return { status: await this.status(id), ...summary }

    await this.db
      .update(broadcasts)
      .set({ recipientCount: progress.recipients })
      .where(this.byId(id))
    await this.audit.log(SYSTEM_ACTOR, {
      action: 'broadcast.sent',
      entityType: 'broadcast',
      entityId: id,
      summary: `Broadcast "${row.name}" sent to ${numberFmt.format(progress.sent)} of ${numberFmt.format(progress.recipients)} recipients`,
      changes: summary
    })
    await this.webhooks.dispatch('broadcast.sent', {
      id,
      name: row.name,
      subject: row.subject,
      ...summary,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null
    })

    return { status: row.status, ...summary }
  }

  /** Terminal failure of the workflow run: unsent messages are cancelled. */
  async fail(id: string, error: string): Promise<void> {
    const [row] = await this.db
      .update(broadcasts)
      .set({ status: 'failed', completedAt: new Date() })
      .where(and(this.byId(id), inArray(broadcasts.status, ACTIVE_STATUSES)))
      .returning()

    if (!row) return
    const message = error.slice(0, 500)
    const unsent = await this.cancelPendingMessages(id, `Broadcast failed: ${message}`)
    await this.audit.log(SYSTEM_ACTOR, {
      action: 'broadcast.failed',
      entityType: 'broadcast',
      entityId: id,
      summary: `Broadcast "${row.name}" failed: ${message}`,
      changes: { error: message, unsent }
    })
  }

  /** Continues a very large send in a fresh workflow run (keeps each run's event log small). */
  async continueInNewRun(id: string): Promise<string> {
    const runId = await this.jobs.sendBroadcast(this.scope.organizationId, id)
    await this.db
      .update(broadcasts)
      .set({ runId })
      .where(and(this.byId(id), inArray(broadcasts.status, ['sending', 'paused'])))

    return runId
  }

  // Helpers --------------------------------------------------------------------

  /** `id = :id` within the organization: another organization's broadcast is never matched. */
  private byId(id: string): SQL | undefined {
    return and(this.scope.eq(broadcasts.organizationId), eq(broadcasts.id, id))
  }

  private assertDraft(broadcast: BroadcastRow) {
    if (broadcast.status !== 'draft') {
      throw new InvalidStateError(
        broadcast.status === 'scheduled'
          ? 'This broadcast is scheduled. Unschedule it to make changes.'
          : `A ${broadcast.status} broadcast can't be changed. Duplicate it to send a new version.`
      )
    }
  }

  /**
   * Template, topic, lists and segments must belong to the organization (ids of
   * another organization are reported as missing). Audience ids already in
   * `storedAudience` are kept even when their list or segment was deleted.
   */
  private async assertReferences(
    input: Pick<BroadcastUpdateInput, 'templateId' | 'topicId' | 'audience'>,
    storedAudience?: AudienceDefinition
  ) {
    if (input.audience) await this.recipientsAudience.assertOwned(input.audience, storedAudience)

    if (input.templateId) {
      const [template] = await this.db
        .select({ id: templates.id })
        .from(templates)
        .where(and(this.scope.eq(templates.organizationId), eq(templates.id, input.templateId)))

      if (!template)
        throw new ValidationError('The selected template no longer exists.', {
          field: 'templateId'
        })
    }

    if (input.topicId) {
      const [topic] = await this.db
        .select({ id: topics.id })
        .from(topics)
        .where(and(this.scope.eq(topics.organizationId), eq(topics.id, input.topicId)))

      if (!topic)
        throw new ValidationError('The selected topic no longer exists.', { field: 'topicId' })
    }
  }

  /** Whether this actor already has an edit entry for the broadcast in the coalescing window. */
  private async recentlyEdited(id: string, actor: Actor): Promise<boolean> {
    const [row] = await this.db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          this.scope.eq(auditLogs.organizationId),
          eq(auditLogs.entityType, 'broadcast'),
          eq(auditLogs.entityId, id),
          eq(auditLogs.action, 'broadcast.updated'),
          actor.id ? eq(auditLogs.actorId, actor.id) : isNull(auditLogs.actorId),
          gte(auditLogs.createdAt, new Date(Date.now() - AUDIT_COALESCE_MS))
        )
      )
      .orderBy(desc(auditLogs.id))
      .limit(1)

    return !!row
  }

  /** Messages not yet handed to the provider are cancelled; returns how many. */
  private async cancelPendingMessages(id: string, reason: string): Promise<number> {
    const result = await this.db
      .update(messages)
      .set({ status: 'cancelled', error: reason })
      .where(
        and(
          this.scope.eq(messages.organizationId),
          eq(messages.broadcastId, id),
          or(
            inArray(messages.status, ['queued', 'scheduled']),
            and(eq(messages.status, 'sending'), isNull(messages.providerMessageId))
          )
        )
      )

    return result.rowCount ?? 0
  }

  private async cancelRun(runId: string) {
    try {
      await this.jobs.cancel(runId)
    } catch (error) {
      // The status change already stops the run at its next step; a stale run id is not an error.
      const reason = error instanceof Error ? error.message : String(error)
      console.warn('[broadcasts] could not cancel workflow run', runId, reason)
    }
  }

  /** The message of a domain error (safe to show), `fallback` for anything else. */
  private message(cause: unknown, fallback: string) {
    return cause instanceof DomainError ? cause.message : fallback
  }
}
