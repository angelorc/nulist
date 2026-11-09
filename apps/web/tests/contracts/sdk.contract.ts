/**
 * Compile-time contract between `@mlist/sdk` and the REST API v1, checked by
 * `nuxi typecheck` (this folder's tsconfig is referenced by the app's). For
 * every endpoint:
 * - the SDK's request type is accepted by the route's zod schema (`z.input`);
 * - what the server's v1 resource resolves to is assignable to the SDK's response type.
 * Nothing here runs: a drift fails the type check.
 */
import type * as Sdk from '@mlist/sdk'
import type { z } from 'zod'
import type { BroadcastApi } from '../../server/lib/api/BroadcastApi'
import type { ContactApi } from '../../server/lib/api/ContactApi'
import type { ListApi } from '../../server/lib/api/ListApi'
import type { TemplateApi } from '../../server/lib/api/TemplateApi'
import type { TransactionalService } from '../../server/lib/transactional/TransactionalService'
import type {
  TransactionalBatchResult,
  transactionalEmailSchema
} from '../../shared/schemas/transactional'
import type {
  v1BroadcastCreateSchema,
  v1BroadcastListQuerySchema,
  v1BroadcastSendSchema,
  v1BroadcastUpdateSchema,
  v1ContactListQuerySchema,
  v1ContactUpdateSchema,
  v1ContactUpsertSchema,
  v1EmailListQuerySchema,
  v1ListCreateSchema,
  v1ListUpdateSchema,
  v1PageQuerySchema,
  v1TemplateCreateSchema,
  v1TemplateListQuerySchema,
  v1TemplateUpdateSchema,
  v1UnsubscribeSchema
} from '../../shared/schemas/v1'

/** `true` when `Actual` is assignable to `Expected` (unions are not distributed). */
type Assignable<Actual, Expected> = [Actual] extends [Expected] ? true : false

/** Fields the SDK sends that the schema does not declare (zod would drop them silently). */
type UndeclaredKeys<Request, Input> = Exclude<keyof Request, keyof NonNullable<Input>>

/** The SDK sends `Request` to a route that parses it with `Schema`, and every field is declared. */
type Accepts<Schema extends z.ZodType, Request> = [
  UndeclaredKeys<Request, z.input<Schema>>
] extends [never]
  ? Assignable<Request, z.input<Schema>>
  : false

/** The server answers with `Served` where the SDK declares `Declared`. */
type Answers<Served, Declared> = Assignable<Served, Declared>

/** Compiles only when every check holds (a failing one is reported with its index). */
type AllHold<Checks extends readonly true[]> = Checks

/** What a server method resolves to. */
type Resolved<Method> = Method extends (...args: never[]) => Promise<infer Result> ? Result : never

/** `emails.*` and `batch.*` → `/api/v1/emails/**`. */
export type EmailsContract = AllHold<
  [
    Accepts<typeof transactionalEmailSchema, Sdk.SendEmailOptions>,
    Assignable<Sdk.SendEmailOptions[], z.input<typeof transactionalEmailSchema>[]>,
    Accepts<typeof v1EmailListQuerySchema, Sdk.ListEmailsOptions>,
    Answers<Resolved<TransactionalService['send']>['email'], Sdk.Email>,
    Answers<TransactionalBatchResult, Sdk.EmailBatch>,
    Answers<Resolved<TransactionalService['sendBatch']>['batch'], Sdk.EmailBatch>,
    Answers<Resolved<TransactionalService['get']>, Sdk.EmailDetail>,
    Answers<Resolved<TransactionalService['list']>, Sdk.Page<Sdk.Email>>,
    Answers<Resolved<TransactionalService['cancel']>, Sdk.Email>
  ]
>

/** `contacts.*` → `/api/v1/contacts/**`. */
export type ContactsContract = AllHold<
  [
    Accepts<typeof v1ContactUpsertSchema, Sdk.CreateContactOptions>,
    Accepts<typeof v1ContactListQuerySchema, Sdk.ListContactsOptions>,
    Accepts<typeof v1ContactUpdateSchema, Sdk.UpdateContactOptions>,
    Accepts<typeof v1UnsubscribeSchema, Sdk.UnsubscribeContactOptions>,
    Answers<Resolved<ContactApi['upsert']>, Sdk.UpsertedContact>,
    Answers<Resolved<ContactApi['get']>, Sdk.Contact>,
    Answers<Resolved<ContactApi['list']>, Sdk.Page<Sdk.ContactSummary>>,
    Answers<Resolved<ContactApi['update']>, Sdk.Contact>,
    Answers<Resolved<ContactApi['delete']>, Sdk.DeletedResource<'contact'>>,
    Answers<Resolved<ContactApi['unsubscribe']>, Sdk.Contact>
  ]
>

/** `lists.*` → `/api/v1/lists/**`. */
export type ListsContract = AllHold<
  [
    Accepts<typeof v1PageQuerySchema, Sdk.PageParams>,
    Accepts<typeof v1ListCreateSchema, Sdk.CreateListOptions>,
    Accepts<typeof v1ListUpdateSchema, Sdk.UpdateListOptions>,
    Answers<Resolved<ListApi['list']>, Sdk.Page<Sdk.MailingList>>,
    Answers<Resolved<ListApi['get']>, Sdk.MailingList>,
    Answers<Resolved<ListApi['create']>, Sdk.MailingList>,
    Answers<Resolved<ListApi['update']>, Sdk.MailingList>,
    Answers<Resolved<ListApi['delete']>, Sdk.DeletedResource<'mailing_list'>>
  ]
>

/** `broadcasts.*` → `/api/v1/broadcasts/**`. */
export type BroadcastsContract = AllHold<
  [
    Accepts<typeof v1BroadcastListQuerySchema, Sdk.ListBroadcastsOptions>,
    Accepts<typeof v1BroadcastCreateSchema, Sdk.CreateBroadcastOptions>,
    Accepts<typeof v1BroadcastUpdateSchema, Sdk.UpdateBroadcastOptions>,
    Accepts<typeof v1BroadcastSendSchema, Sdk.SendBroadcastOptions>,
    Answers<Resolved<BroadcastApi['list']>, Sdk.Page<Sdk.BroadcastListItem>>,
    Answers<Resolved<BroadcastApi['get']>, Sdk.BroadcastDetail>,
    Answers<Resolved<BroadcastApi['create']>, Sdk.Broadcast>,
    Answers<Resolved<BroadcastApi['update']>, Sdk.Broadcast>,
    Answers<Resolved<BroadcastApi['delete']>, Sdk.DeletedResource<'broadcast'>>,
    Answers<Resolved<BroadcastApi['send']>, Sdk.Broadcast>,
    Answers<Resolved<BroadcastApi['cancel']>, Sdk.Broadcast>
  ]
>

/** `templates.*` → `/api/v1/templates/**`. */
export type TemplatesContract = AllHold<
  [
    Accepts<typeof v1TemplateListQuerySchema, Sdk.ListTemplatesOptions>,
    Accepts<typeof v1TemplateCreateSchema, Sdk.CreateTemplateOptions>,
    Accepts<typeof v1TemplateUpdateSchema, Sdk.UpdateTemplateOptions>,
    Answers<Resolved<TemplateApi['list']>, Sdk.Page<Sdk.TemplateSummary>>,
    Answers<Resolved<TemplateApi['get']>, Sdk.Template>,
    Answers<Resolved<TemplateApi['create']>, Sdk.SavedTemplate>,
    Answers<Resolved<TemplateApi['update']>, Sdk.SavedTemplate>,
    Answers<Resolved<TemplateApi['delete']>, Sdk.DeletedResource<'template'>>
  ]
>
