import { relations, sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core'
import { apikey, organization, user } from './auth-schema'
import type {
  AudienceDefinition,
  ImportMapping,
  ImportRowError,
  JsonObject,
  SegmentRules,
  SettingsMap,
  SettingsSection,
  UtmSettings
} from '../../shared/types/domain'
import type { AccessSettings } from '../../shared/schemas/access'

export interface InstanceSettingsMap {
  access: AccessSettings
}

export type InstanceSettingsKey = keyof InstanceSettingsMap

export * from './auth-schema'

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`)

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

const ts = (name: string) => timestamp(name, { withTimezone: true })

/** Owning organization of a tenant row (deleting the organization deletes its data). */
const organizationId = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' })

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const contactStatus = pgEnum('contact_status', [
  'active',
  'unsubscribed',
  'bounced',
  'complained',
  'blocklisted'
])

export const optInMode = pgEnum('opt_in_mode', ['single', 'double'])

export const subscriptionStatus = pgEnum('subscription_status', [
  'unconfirmed',
  'confirmed',
  'unsubscribed'
])

export const templateKind = pgEnum('template_kind', ['marketing', 'transactional'])
export const templateEditor = pgEnum('template_editor', ['visual', 'code'])

export const broadcastStatus = pgEnum('broadcast_status', [
  'draft',
  'scheduled',
  'sending',
  'paused',
  'sent',
  'cancelled',
  'failed'
])

export const messageKind = pgEnum('message_kind', ['broadcast', 'transactional', 'system'])

export const messageStatus = pgEnum('message_status', [
  'queued',
  'scheduled',
  'sending',
  'sent',
  'delivered',
  'delayed',
  'bounced',
  'complained',
  'failed',
  'rejected',
  'suppressed',
  'cancelled'
])

export const emailEventType = pgEnum('email_event_type', [
  'send',
  'delivery',
  'bounce',
  'complaint',
  'reject',
  'open',
  'click',
  'delivery_delay',
  'rendering_failure',
  'unsubscribe',
  'failed'
])

export const suppressionReason = pgEnum('suppression_reason', [
  'hard_bounce',
  'soft_bounce',
  'complaint',
  'unsubscribe',
  'manual'
])

export const importStatus = pgEnum('import_status', [
  'pending',
  'processing',
  'completed',
  'failed'
])

export const importMode = pgEnum('import_mode', ['skip', 'merge', 'overwrite'])

/** Subscription given to imported contacts on a double opt-in list. */
export const importSubscription = pgEnum('import_subscription', ['confirmed', 'send_opt_in'])
export const actorType = pgEnum('actor_type', ['user', 'api_key', 'system'])
export const deliveryStatus = pgEnum('delivery_status', ['pending', 'success', 'failed'])
export const inboundStatus = pgEnum('inbound_status', ['processed', 'ignored', 'failed'])

// ---------------------------------------------------------------------------
// Access (users, sessions, accounts, API keys) is owned by Better Auth: see ./auth-schema.ts
// ---------------------------------------------------------------------------
export const settings = pgTable(
  'settings',
  {
    organizationId: organizationId(),
    key: text('key').$type<SettingsSection>().notNull(),
    /** One settings section (secrets encrypted); merged over the defaults on read. */
    value: jsonb('value').$type<SettingsMap[SettingsSection]>().notNull(),
    updatedAt: updatedAt()
  },
  (t) => [primaryKey({ name: 'settings_pkey', columns: [t.organizationId, t.key] })]
)

export const instanceSettings = pgTable('instance_settings', {
  key: text('key').$type<InstanceSettingsKey>().primaryKey(),
  value: jsonb('value').$type<InstanceSettingsMap[InstanceSettingsKey]>().notNull(),
  updatedAt: updatedAt()
})

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------
export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    organizationId: organizationId(),
    email: text('email').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    attributes: jsonb('attributes').$type<JsonObject>().notNull().default({}),
    status: contactStatus('status').notNull().default('active'),
    source: text('source'),
    consentIp: text('consent_ip'),
    consentAt: ts('consent_at'),
    softBounceCount: integer('soft_bounce_count').notNull().default(0),
    lastOpenedAt: ts('last_opened_at'),
    lastClickedAt: ts('last_clicked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    uniqueIndex('contacts_org_email_uq').on(t.organizationId, t.email),
    index('contacts_status_idx').on(t.organizationId, t.status),
    index('contacts_created_idx').on(t.organizationId, t.createdAt),
    index('contacts_attributes_idx').using('gin', t.attributes),
    // Contact search (ContactFilter.search): one trigram index over email + names; needs pg_trgm.
    index('contacts_search_trgm_idx').using(
      'gin',
      sql`(email || ' ' || coalesce(first_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops`
    )
  ]
)

export const lists = pgTable(
  'lists',
  {
    id: id(),
    organizationId: organizationId(),
    name: text('name').notNull(),
    description: text('description'),
    optIn: optInMode('opt_in').notNull().default('single'),
    isPublic: boolean('is_public').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index('lists_org_created_idx').on(t.organizationId, t.createdAt)]
)

export const listSubscriptions = pgTable(
  'list_subscriptions',
  {
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    status: subscriptionStatus('status').notNull().default('confirmed'),
    confirmedAt: ts('confirmed_at'),
    unsubscribedAt: ts('unsubscribed_at'),
    createdAt: createdAt()
  },
  (t) => [
    primaryKey({ columns: [t.listId, t.contactId] }),
    index('list_subscriptions_contact_idx').on(t.contactId),
    // Members page (ListService.members), newest first, with and without a status filter:
    // read in index order, never sorted.
    index('list_subscriptions_status_idx').on(t.listId, t.status, t.createdAt, t.contactId),
    index('list_subscriptions_list_created_idx').on(t.listId, t.createdAt, t.contactId),
    // Dashboard audience growth (AudienceGrowthQuery): subscriptions and opt-outs in a period.
    index('list_subscriptions_list_confirmed_idx').on(t.listId, t.confirmedAt),
    index('list_subscriptions_list_unsubscribed_idx').on(t.listId, t.unsubscribedAt)
  ]
)

export const topics = pgTable(
  'topics',
  {
    id: id(),
    organizationId: organizationId(),
    name: text('name').notNull(),
    description: text('description'),
    defaultSubscribed: boolean('default_subscribed').notNull().default(true),
    createdAt: createdAt()
  },
  (t) => [index('topics_org_created_idx').on(t.organizationId, t.createdAt)]
)

export const contactTopics = pgTable(
  'contact_topics',
  {
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    subscribed: boolean('subscribed').notNull(),
    updatedAt: updatedAt()
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.topicId] }),
    // Deleting a topic cascades here: topic_id is only the second column of the key.
    index('contact_topics_topic_idx').on(t.topicId)
  ]
)

export const segments = pgTable(
  'segments',
  {
    id: id(),
    organizationId: organizationId(),
    name: text('name').notNull(),
    description: text('description'),
    rules: jsonb('rules').$type<SegmentRules>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index('segments_org_updated_idx').on(t.organizationId, t.updatedAt)]
)

export const suppressions = pgTable(
  'suppressions',
  {
    id: id(),
    organizationId: organizationId(),
    email: text('email').notNull(),
    reason: suppressionReason('reason').notNull(),
    source: text('source'),
    createdAt: createdAt()
  },
  (t) => [
    uniqueIndex('suppressions_org_email_uq').on(t.organizationId, t.email),
    index('suppressions_org_created_idx').on(t.organizationId, t.createdAt)
  ]
)

export const imports = pgTable(
  'imports',
  {
    id: id(),
    organizationId: organizationId(),
    fileName: text('file_name').notNull(),
    status: importStatus('status').notNull().default('pending'),
    listId: uuid('list_id').references(() => lists.id, { onDelete: 'set null' }),
    mapping: jsonb('mapping').$type<ImportMapping>().notNull(),
    mode: importMode('mode').notNull().default('merge'),
    subscription: importSubscription('subscription').notNull().default('confirmed'),
    csv: text('csv'),
    totalRows: integer('total_rows').notNull().default(0),
    processedRows: integer('processed_rows').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    errors: jsonb('errors').$type<ImportRowError[]>().notNull().default([]),
    runId: text('run_id'),
    createdById: uuid('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    completedAt: ts('completed_at')
  },
  (t) => [index('imports_org_created_idx').on(t.organizationId, t.createdAt)]
)

export const importRows = pgTable(
  'import_rows',
  {
    importId: uuid('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(),
    data: jsonb('data').$type<Record<string, string>>().notNull()
  },
  (t) => [primaryKey({ columns: [t.importId, t.rowNumber] })]
)

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------
export const templates = pgTable(
  'templates',
  {
    id: id(),
    organizationId: organizationId(),
    name: text('name').notNull(),
    slug: text('slug'),
    kind: templateKind('kind').notNull().default('marketing'),
    editor: templateEditor('editor').notNull().default('visual'),
    subject: text('subject').notNull().default(''),
    preheader: text('preheader'),
    mjml: text('mjml').notNull(),
    design: jsonb('design'),
    html: text('html'),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    // Many templates may have no slug (NULLs never collide).
    uniqueIndex('templates_org_slug_uq').on(t.organizationId, t.slug),
    index('templates_org_updated_idx').on(t.organizationId, t.updatedAt)
  ]
)

/** Colours the organization saved from the visual editor's colour picker (`#rrggbb`). */
export const savedColors = pgTable(
  'saved_colors',
  {
    organizationId: organizationId(),
    color: text('color').notNull(),
    createdAt: createdAt()
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.color] })]
)

export const files = pgTable(
  'files',
  {
    id: id(),
    organizationId: organizationId(),
    // Object keys are unique across the instance (organizations may share a bucket).
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    url: text('url').notNull(),
    createdById: uuid('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt()
  },
  (t) => [index('files_org_created_idx').on(t.organizationId, t.createdAt)]
)

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
export const broadcasts = pgTable(
  'broadcasts',
  {
    id: id(),
    organizationId: organizationId(),
    name: text('name').notNull(),
    subject: text('subject').notNull().default(''),
    preheader: text('preheader'),
    fromName: text('from_name'),
    fromEmail: text('from_email'),
    replyTo: text('reply_to'),
    templateId: uuid('template_id').references(() => templates.id, { onDelete: 'set null' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    audience: jsonb('audience')
      .$type<AudienceDefinition>()
      .notNull()
      .default({ listIds: [], segmentIds: [], excludeListIds: [] }),
    utm: jsonb('utm').$type<UtmSettings>().notNull().default({ enabled: false }),
    status: broadcastStatus('status').notNull().default('draft'),
    scheduledAt: ts('scheduled_at'),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    recipientCount: integer('recipient_count').notNull().default(0),
    htmlSnapshot: text('html_snapshot'),
    runId: text('run_id'),
    createdById: uuid('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    index('broadcasts_status_idx').on(t.organizationId, t.status),
    index('broadcasts_org_created_idx').on(t.organizationId, t.createdAt)
  ]
)

export const messages = pgTable(
  'messages',
  {
    id: id(),
    organizationId: organizationId(),
    kind: messageKind('kind').notNull(),
    broadcastId: uuid('broadcast_id').references(() => broadcasts.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    templateId: uuid('template_id').references(() => templates.id, { onDelete: 'set null' }),
    apiKeyId: uuid('api_key_id').references(() => apikey.id, { onDelete: 'set null' }),
    topicId: uuid('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    toEmail: text('to_email').notNull(),
    fromEmail: text('from_email').notNull(),
    replyTo: text('reply_to'),
    subject: text('subject').notNull(),
    html: text('html'),
    text: text('text'),
    variables: jsonb('variables').$type<JsonObject>(),
    tags: jsonb('tags').$type<Record<string, string>>().notNull().default({}),
    status: messageStatus('status').notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    idempotencyKey: text('idempotency_key'),
    requestHash: text('request_hash'),
    scheduledAt: ts('scheduled_at'),
    sentAt: ts('sent_at'),
    deliveredAt: ts('delivered_at'),
    openedAt: ts('opened_at'),
    clickedAt: ts('clicked_at'),
    openCount: integer('open_count').notNull().default(0),
    clickCount: integer('click_count').notNull().default(0),
    runId: text('run_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    uniqueIndex('messages_broadcast_contact_uq').on(t.broadcastId, t.contactId),
    uniqueIndex('messages_idempotency_uq').on(t.apiKeyId, t.idempotencyKey),
    uniqueIndex('messages_provider_id_uq').on(t.providerMessageId),
    index('messages_broadcast_status_idx').on(t.broadcastId, t.status),
    index('messages_contact_idx').on(t.contactId),
    index('messages_created_idx').on(t.organizationId, t.createdAt),
    index('messages_status_idx').on(t.organizationId, t.status),
    index('messages_org_kind_created_idx').on(t.organizationId, t.kind, t.createdAt),
    index('messages_org_sent_idx').on(t.organizationId, t.sentAt),
    // ON DELETE SET NULL of templates and topics updates messages through these.
    index('messages_template_idx')
      .on(t.templateId)
      .where(sql`${t.templateId} is not null`),
    index('messages_topic_idx')
      .on(t.topicId)
      .where(sql`${t.topicId} is not null`),
    // Email log search (LogService.emails): substring match on recipient and subject; needs pg_trgm.
    index('messages_to_email_trgm_idx').using('gin', sql`${t.toEmail} gin_trgm_ops`),
    index('messages_subject_trgm_idx').using('gin', sql`${t.subject} gin_trgm_ops`)
  ]
)

export const emailEvents = pgTable(
  'email_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    organizationId: organizationId(),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    broadcastId: uuid('broadcast_id').references(() => broadcasts.id, { onDelete: 'set null' }),
    type: emailEventType('type').notNull(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    data: jsonb('data').$type<JsonObject>().notNull().default({}),
    createdAt: createdAt()
  },
  (t) => [
    index('email_events_type_time_idx').on(t.organizationId, t.type, t.occurredAt),
    index('email_events_message_idx').on(t.messageId),
    index('email_events_broadcast_idx').on(t.broadcastId, t.type),
    // Contact activity timeline and engagement segment conditions.
    index('email_events_contact_time_idx').on(t.contactId, t.occurredAt.desc()),
    index('email_events_contact_type_idx').on(t.contactId, t.type, t.occurredAt)
  ]
)

// ---------------------------------------------------------------------------
// Integrations & observability
// ---------------------------------------------------------------------------
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: id(),
    organizationId: organizationId(),
    url: text('url').notNull(),
    description: text('description'),
    events: text('events')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    secret: text('secret').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Failed attempts in a row (circuit breaker; reset by a successful attempt). */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastFailureAt: ts('last_failure_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index('webhook_endpoints_org_idx').on(t.organizationId, t.createdAt)]
)

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    organizationId: organizationId(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    status: deliveryStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    durationMs: integer('duration_ms'),
    lastAttemptAt: ts('last_attempt_at'),
    createdAt: createdAt()
  },
  (t) => [
    index('webhook_deliveries_endpoint_idx').on(t.endpointId, t.createdAt),
    index('webhook_deliveries_org_created_idx').on(t.organizationId, t.createdAt)
  ]
)

export const inboundEvents = pgTable(
  'inbound_events',
  {
    id: id(),
    /** Set once the event is correlated with an organization's message (null: instance-level). */
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'cascade'
    }),
    // SNS deduplication is instance-wide: one endpoint serves every organization.
    snsMessageId: text('sns_message_id').notNull().unique(),
    type: text('type').notNull(),
    eventType: text('event_type'),
    topicArn: text('topic_arn'),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    status: inboundStatus('status').notNull(),
    error: text('error'),
    createdAt: createdAt()
  },
  (t) => [
    index('inbound_events_created_idx').on(t.createdAt),
    index('inbound_events_org_created_idx').on(t.organizationId, t.createdAt)
  ]
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Null for instance-level actions; kept (set null) when the organization is deleted. */
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'set null'
    }),
    actorType: actorType('actor_type').notNull(),
    actorId: text('actor_id'),
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    summary: text('summary').notNull(),
    changes: jsonb('changes').$type<JsonObject>(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt()
  },
  (t) => [
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_org_id_idx').on(t.organizationId, t.id),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId)
  ]
)

export const apiLogs = pgTable(
  'api_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Null for requests rejected before a key (and so an organization) was known. */
    organizationId: uuid('organization_id').references(() => organization.id, {
      onDelete: 'cascade'
    }),
    apiKeyId: uuid('api_key_id').references(() => apikey.id, { onDelete: 'set null' }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    statusCode: integer('status_code').notNull(),
    durationMs: integer('duration_ms').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestBody: jsonb('request_body'),
    responseBody: jsonb('response_body'),
    createdAt: createdAt()
  },
  (t) => [
    index('api_logs_created_idx').on(t.createdAt),
    index('api_logs_org_created_idx').on(t.organizationId, t.createdAt),
    // Deleting an API key sets api_key_id to null here.
    index('api_logs_api_key_idx')
      .on(t.apiKeyId)
      .where(sql`${t.apiKeyId} is not null`)
  ]
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const contactsRelations = relations(contacts, ({ many }) => ({
  subscriptions: many(listSubscriptions),
  topics: many(contactTopics),
  messages: many(messages)
}))

export const listsRelations = relations(lists, ({ many }) => ({
  subscriptions: many(listSubscriptions)
}))

export const listSubscriptionsRelations = relations(listSubscriptions, ({ one }) => ({
  list: one(lists, { fields: [listSubscriptions.listId], references: [lists.id] }),
  contact: one(contacts, { fields: [listSubscriptions.contactId], references: [contacts.id] })
}))

export const contactTopicsRelations = relations(contactTopics, ({ one }) => ({
  contact: one(contacts, { fields: [contactTopics.contactId], references: [contacts.id] }),
  topic: one(topics, { fields: [contactTopics.topicId], references: [topics.id] })
}))

export const broadcastsRelations = relations(broadcasts, ({ one, many }) => ({
  template: one(templates, { fields: [broadcasts.templateId], references: [templates.id] }),
  topic: one(topics, { fields: [broadcasts.topicId], references: [topics.id] }),
  messages: many(messages)
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
  broadcast: one(broadcasts, { fields: [messages.broadcastId], references: [broadcasts.id] }),
  contact: one(contacts, { fields: [messages.contactId], references: [contacts.id] }),
  template: one(templates, { fields: [messages.templateId], references: [templates.id] }),
  events: many(emailEvents)
}))

export const emailEventsRelations = relations(emailEvents, ({ one }) => ({
  message: one(messages, { fields: [emailEvents.messageId], references: [messages.id] })
}))

export const webhookEndpointsRelations = relations(webhookEndpoints, ({ many }) => ({
  deliveries: many(webhookDeliveries)
}))

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  endpoint: one(webhookEndpoints, {
    fields: [webhookDeliveries.endpointId],
    references: [webhookEndpoints.id]
  })
}))
