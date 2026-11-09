import { z } from 'zod'
import { API_KEY_SCOPES, grants } from '../auth/permissions'
import type { PermissionRequest } from '../auth/permissions'
import type { BroadcastListStats, BroadcastProgress } from '../types/broadcasts'
import type {
  ApiKeyScope,
  AudienceDefinition,
  BroadcastStatus,
  ContactStatus,
  JsonObject,
  OptInMode,
  SubscriptionStatus,
  TemplateEditor,
  TemplateKind,
  UtmSettings
} from '../types/domain'
import {
  broadcastCreateSchema,
  broadcastListQuerySchema,
  broadcastUpdateSchema
} from './broadcasts'
import {
  CONTACT_SORTS,
  contactAttributesSchema,
  contactEmailSchema,
  contactFilterSchema,
  contactUpdateSchema
} from './contacts'
import { listInputSchema, listUpdateSchema } from './lists'
import { MESSAGE_STATUSES } from './logs'
import {
  templateEditorSchema,
  templateKindSchema,
  templateSlugSchema,
  templateUpdateSchema
} from './templates'
import type { TemplateIssue } from './templates'

/**
 * Public REST API v1: request schemas, response shapes and the endpoint
 * catalogue rendered by the dashboard (Transactional → API reference).
 */

const nameSchema = z
  .string()
  .trim()
  .max(100)
  .nullish()
  .transform((v) => v || null)

export const v1ContactUpsertSchema = z.object({
  email: contactEmailSchema,
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  attributes: contactAttributesSchema.optional(),
  /** Lists to subscribe the contact to. */
  listIds: z.array(z.uuid('listIds must contain list UUIDs')).max(50).default([]),
  /** Confirm double opt-in lists immediately (you vouch for consent). */
  skipOptIn: z.boolean().default(false)
})

export type V1ContactUpsertInput = z.infer<typeof v1ContactUpsertSchema>

/** `/api/v1/contacts/{email}`: the address may be URL-encoded. */
export const v1ContactParamsSchema = z.object({ email: contactEmailSchema })

export const v1UnsubscribeSchema = z
  .object({
    /** Omit to unsubscribe from every email (global opt-out + suppression). */
    listId: z.uuid('listId must be a UUID').optional()
  })
  .nullish()
  .transform((value) => value ?? {})

export const v1EmailParamsSchema = z.object({ id: z.uuid('Email id must be a UUID') })

/** `/api/v1/{lists,broadcasts}/{id}`. */
export const v1IdParamsSchema = z.object({ id: z.uuid('id must be a UUID') })

/** `/api/v1/templates/{id}`: a template id or its slug. */
export const v1TemplateParamsSchema = z.object({
  id: z.union([z.uuid(), templateSlugSchema], {
    error: 'Use a template id (UUID) or slug'
  })
})

/** `?page&pageSize` of every paginated v1 list endpoint. */
export const v1PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
})

export type V1PageQuery = z.infer<typeof v1PageQuerySchema>

/** `GET /api/v1/emails`: transactional emails, newest first. */
export const v1EmailListQuerySchema = v1PageQuerySchema.extend({
  status: z.enum(MESSAGE_STATUSES).optional()
})

export type V1EmailListQuery = z.infer<typeof v1EmailListQuerySchema>

/** `GET /api/v1/contacts`: `q` searches email and name, `listId` keeps current members. */
export const v1ContactListQuerySchema = contactFilterSchema.extend(v1PageQuerySchema.shape).extend({
  sort: z.enum(CONTACT_SORTS).default('-createdAt')
})

export type V1ContactListQuery = z.infer<typeof v1ContactListQuerySchema>

/** `PATCH /api/v1/contacts/{email}`: the fields the dashboard edits (profile, attributes, status). */
export const v1ContactUpdateSchema = contactUpdateSchema

export type V1ContactUpdateInput = z.infer<typeof v1ContactUpdateSchema>

export const v1ListCreateSchema = listInputSchema

export type V1ListCreateInput = z.infer<typeof v1ListCreateSchema>

export const v1ListUpdateSchema = listUpdateSchema

export type V1ListUpdateInput = z.infer<typeof v1ListUpdateSchema>

/** `?status` is an index tab: `sending` includes paused, `cancelled` includes failed. */
export const v1BroadcastListQuerySchema = broadcastListQuerySchema

export type V1BroadcastListQuery = z.infer<typeof v1BroadcastListQuerySchema>

/** Creates a draft; every field can be completed later with PATCH. */
export const v1BroadcastCreateSchema = broadcastCreateSchema

export type V1BroadcastCreateInput = z.infer<typeof v1BroadcastCreateSchema>

export const v1BroadcastUpdateSchema = broadcastUpdateSchema

export type V1BroadcastUpdateInput = z.infer<typeof v1BroadcastUpdateSchema>

/** `POST /api/v1/broadcasts/{id}/send`: omit `scheduledAt` (or the body) to send now. */
export const v1BroadcastSendSchema = z
  .object({
    scheduledAt: z.iso
      .datetime({
        offset: true,
        error: 'scheduledAt must be an ISO 8601 date-time, e.g. 2026-05-01T09:00:00Z'
      })
      .nullish()
  })
  .nullish()
  .transform((value) => value ?? {})

export const v1TemplateListQuerySchema = v1PageQuerySchema.extend({
  kind: templateKindSchema.optional(),
  /** Matches name, slug or subject. */
  q: z.string().trim().max(200).optional()
})

export type V1TemplateListQuery = z.infer<typeof v1TemplateListQuerySchema>

/** API templates are edited as code; omit `mjml` to start from the default layout. */
export const v1TemplateCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    kind: templateKindSchema.default('marketing'),
    editor: templateEditorSchema.default('code'),
    slug: templateSlugSchema.nullish(),
    subject: z.string().trim().max(300).optional(),
    preheader: z.string().trim().max(300).nullish(),
    mjml: templateUpdateSchema.shape.mjml.unwrap().optional()
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'transactional' && !value.slug) {
      ctx.addIssue({
        code: 'custom',
        path: ['slug'],
        message: 'Transactional templates need a slug'
      })
    }
  })

export type V1TemplateCreateInput = z.infer<typeof v1TemplateCreateSchema>

/** Every field optional; the visual editor's project data is not part of the API. */
export const v1TemplateUpdateSchema = templateUpdateSchema.omit({ design: true })

export type V1TemplateUpdateInput = z.infer<typeof v1TemplateUpdateSchema>

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface V1ErrorBody {
  error: {
    code: string
    message: string
    details?: JsonObject
  }
}

export interface V1ContactList {
  id: string
  name: string
  status: SubscriptionStatus
}

export interface V1Contact {
  id: string
  object: 'contact'
  email: string
  firstName: string | null
  lastName: string | null
  status: ContactStatus
  attributes: JsonObject
  lists: V1ContactList[]
  createdAt: string
  updatedAt: string
}

export type V1SubscriptionOutcome = 'confirmed' | 'unconfirmed' | 'already_subscribed' | 'skipped'

export interface V1SubscriptionResult {
  listId: string
  status: V1SubscriptionOutcome
  /** Why a subscription was skipped (e.g. the contact unsubscribed from that list before). */
  reason?: string
}

export interface V1ContactUpsertResult extends V1Contact {
  created: boolean
  subscriptions: V1SubscriptionResult[]
}

/** A contact in `GET /api/v1/contacts` (without its subscriptions). */
export interface V1ContactSummary {
  id: string
  object: 'contact'
  email: string
  firstName: string | null
  lastName: string | null
  status: ContactStatus
  source: string | null
  /** Lists the contact is subscribed to (confirmed or pending). */
  listCount: number
  lastOpenedAt: string | null
  createdAt: string
}

/** Resources a DELETE can remove. */
export type V1DeletableObject = 'contact' | 'mailing_list' | 'broadcast' | 'template'

export interface V1DeletedResource<O extends V1DeletableObject = 'contact'> {
  id: string
  object: O
  deleted: true
}

/** Every paginated list endpoint answers with this envelope (newest first). */
export interface V1Page<T> {
  object: 'list'
  data: T[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

/** A mailing list (`object` is not `list`: that value marks list envelopes). */
export interface V1List {
  id: string
  object: 'mailing_list'
  name: string
  description: string | null
  optIn: OptInMode
  isPublic: boolean
  confirmedCount: number
  unconfirmedCount: number
  unsubscribedCount: number
  createdAt: string
  updatedAt: string
}

export interface V1TemplateSummary {
  id: string
  object: 'template'
  name: string
  /** Used as `template` when sending; transactional templates always have one. */
  slug: string | null
  kind: TemplateKind
  editor: TemplateEditor
  subject: string
  preheader: string | null
  createdAt: string
  updatedAt: string
}

export interface V1Template extends V1TemplateSummary {
  mjml: string
  /** Compiled HTML (Liquid variables still unrendered). */
  html: string | null
}

/** A created or updated template plus non-blocking MJML warnings. */
export interface V1TemplateSaveResult extends V1Template {
  warnings: TemplateIssue[]
}

export interface V1BroadcastSummary {
  id: string
  object: 'broadcast'
  name: string
  subject: string
  preheader: string | null
  fromName: string | null
  fromEmail: string | null
  replyTo: string | null
  templateId: string | null
  topicId: string | null
  status: BroadcastStatus
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  recipientCount: number
  createdAt: string
  updatedAt: string
}

export interface V1BroadcastListItem extends V1BroadcastSummary {
  stats: BroadcastListStats
}

export interface V1Broadcast extends V1BroadcastSummary {
  audience: AudienceDefinition
  utm: UtmSettings
}

export interface V1BroadcastDetail extends V1Broadcast {
  progress: BroadcastProgress
}

// ---------------------------------------------------------------------------
// Endpoint catalogue (dashboard reference)
// ---------------------------------------------------------------------------

export interface V1Endpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  /** What the API key's permissions must cover (403 `insufficient_scope` otherwise). */
  permission: PermissionRequest
  description: string
}

/** Permissions of each REST API v1 endpoint (the route handlers declare the same). */
export const V1_PERMISSIONS = {
  sendEmail: { transactional: ['send'] },
  readEmail: { transactional: ['read'] },
  /** Cancelling a scheduled email is part of sending it. */
  cancelEmail: { transactional: ['send'] },
  /** Creates or updates the contact and subscribes it to lists. */
  upsertContact: { contact: ['create', 'update'] },
  readContact: { contact: ['read'] },
  updateContact: { contact: ['update'] },
  deleteContact: { contact: ['delete'] },
  unsubscribeContact: { contact: ['update'] },
  readList: { list: ['read'] },
  createList: { list: ['create'] },
  updateList: { list: ['update'] },
  deleteList: { list: ['delete'] },
  readBroadcast: { broadcast: ['read'] },
  createBroadcast: { broadcast: ['create'] },
  updateBroadcast: { broadcast: ['update'] },
  deleteBroadcast: { broadcast: ['delete'] },
  /** Sending now, scheduling and cancelling (same as the dashboard). */
  sendBroadcast: { broadcast: ['send'] },
  readTemplate: { template: ['read'] },
  createTemplate: { template: ['create'] },
  updateTemplate: { template: ['update'] },
  deleteTemplate: { template: ['delete'] }
} as const satisfies Record<string, PermissionRequest>

export const V1_ENDPOINTS: readonly V1Endpoint[] = [
  {
    method: 'POST',
    path: '/api/v1/emails',
    permission: V1_PERMISSIONS.sendEmail,
    description:
      'Send one email from a template or raw HTML. Supports Idempotency-Key and scheduledAt.'
  },
  {
    method: 'POST',
    path: '/api/v1/emails/batch',
    permission: V1_PERMISSIONS.sendEmail,
    description:
      'Send up to 100 emails in one request. Validated as a whole before anything is queued.'
  },
  {
    method: 'GET',
    path: '/api/v1/emails',
    permission: V1_PERMISSIONS.readEmail,
    description: 'List transactional emails, newest first (page, pageSize, status).'
  },
  {
    method: 'GET',
    path: '/api/v1/emails/{id}',
    permission: V1_PERMISSIONS.readEmail,
    description: 'Retrieve an email with its status and delivery events.'
  },
  {
    method: 'POST',
    path: '/api/v1/emails/{id}/cancel',
    permission: V1_PERMISSIONS.cancelEmail,
    description: 'Cancel a scheduled email before it is sent.'
  },
  {
    method: 'GET',
    path: '/api/v1/contacts',
    permission: V1_PERMISSIONS.readContact,
    description: 'List contacts (page, pageSize, q, status, listId, sort).'
  },
  {
    method: 'POST',
    path: '/api/v1/contacts',
    permission: V1_PERMISSIONS.upsertContact,
    description: 'Create or update a contact by email and subscribe it to lists.'
  },
  {
    method: 'GET',
    path: '/api/v1/contacts/{email}',
    permission: V1_PERMISSIONS.readContact,
    description: 'Retrieve a contact with its list subscriptions.'
  },
  {
    method: 'PATCH',
    path: '/api/v1/contacts/{email}',
    permission: V1_PERMISSIONS.updateContact,
    description: 'Update the name, email, attributes or status of a contact.'
  },
  {
    method: 'DELETE',
    path: '/api/v1/contacts/{email}',
    permission: V1_PERMISSIONS.deleteContact,
    description: 'Delete a contact and its subscriptions.'
  },
  {
    method: 'POST',
    path: '/api/v1/contacts/{email}/unsubscribe',
    permission: V1_PERMISSIONS.unsubscribeContact,
    description: 'Unsubscribe from one list (listId) or from every email.'
  },
  {
    method: 'GET',
    path: '/api/v1/lists',
    permission: V1_PERMISSIONS.readList,
    description: 'List mailing lists with their subscriber counts.'
  },
  {
    method: 'POST',
    path: '/api/v1/lists',
    permission: V1_PERMISSIONS.createList,
    description: 'Create a mailing list (single or double opt-in).'
  },
  {
    method: 'GET',
    path: '/api/v1/lists/{id}',
    permission: V1_PERMISSIONS.readList,
    description: 'Retrieve a mailing list with its subscriber counts.'
  },
  {
    method: 'PATCH',
    path: '/api/v1/lists/{id}',
    permission: V1_PERMISSIONS.updateList,
    description: 'Rename a list or change its opt-in mode and visibility.'
  },
  {
    method: 'DELETE',
    path: '/api/v1/lists/{id}',
    permission: V1_PERMISSIONS.deleteList,
    description: 'Delete a list and its subscriptions (contacts are kept).'
  },
  {
    method: 'GET',
    path: '/api/v1/broadcasts',
    permission: V1_PERMISSIONS.readBroadcast,
    description: 'List broadcasts with their delivery stats (page, pageSize, q, status).'
  },
  {
    method: 'POST',
    path: '/api/v1/broadcasts',
    permission: V1_PERMISSIONS.createBroadcast,
    description: 'Create a draft broadcast.'
  },
  {
    method: 'GET',
    path: '/api/v1/broadcasts/{id}',
    permission: V1_PERMISSIONS.readBroadcast,
    description: 'Retrieve a broadcast with its audience and sending progress.'
  },
  {
    method: 'PATCH',
    path: '/api/v1/broadcasts/{id}',
    permission: V1_PERMISSIONS.updateBroadcast,
    description: 'Edit a draft broadcast.'
  },
  {
    method: 'DELETE',
    path: '/api/v1/broadcasts/{id}',
    permission: V1_PERMISSIONS.deleteBroadcast,
    description:
      'Delete a draft, or a broadcast cancelled before sending started (cancel a scheduled one first).'
  },
  {
    method: 'POST',
    path: '/api/v1/broadcasts/{id}/send',
    permission: V1_PERMISSIONS.sendBroadcast,
    description: 'Send a draft now, or schedule it with scheduledAt. Runs the pre-flight checks.'
  },
  {
    method: 'POST',
    path: '/api/v1/broadcasts/{id}/cancel',
    permission: V1_PERMISSIONS.sendBroadcast,
    description: 'Cancel a scheduled, sending or paused broadcast; unsent emails are dropped.'
  },
  {
    method: 'GET',
    path: '/api/v1/templates',
    permission: V1_PERMISSIONS.readTemplate,
    description: 'List templates (page, pageSize, kind, q).'
  },
  {
    method: 'POST',
    path: '/api/v1/templates',
    permission: V1_PERMISSIONS.createTemplate,
    description: 'Create an MJML + Liquid template (transactional templates need a slug).'
  },
  {
    method: 'GET',
    path: '/api/v1/templates/{id}',
    permission: V1_PERMISSIONS.readTemplate,
    description: 'Retrieve a template by id or slug, with its MJML and compiled HTML.'
  },
  {
    method: 'PATCH',
    path: '/api/v1/templates/{id}',
    permission: V1_PERMISSIONS.updateTemplate,
    description: 'Update a template by id or slug; returns MJML warnings.'
  },
  {
    method: 'DELETE',
    path: '/api/v1/templates/{id}',
    permission: V1_PERMISSIONS.deleteTemplate,
    description: 'Delete a template not used by a scheduled or sending broadcast.'
  }
]

/** Key scopes in order of least privilege. */
const SCOPES_BY_PRIVILEGE: readonly ApiKeyScope[] = ['sending', 'full']

/** The least privileged API key scope that covers `permission`, or null when none does. */
export function scopeCovering(permission: PermissionRequest): ApiKeyScope | null {
  return SCOPES_BY_PRIVILEGE.find((scope) => grants(API_KEY_SCOPES[scope], permission)) ?? null
}
