import type { RequestOptions } from '../core/request-options'
import { RequestPath } from '../core/request-path'
import type { NulistResponse } from '../core/response'
import type { Transport } from '../core/transport'
import type { DeletedResource, Page } from '../types/common'
import type {
  Contact,
  ContactSummary,
  CreateContactOptions,
  ListContactsOptions,
  UnsubscribeContactOptions,
  UpdateContactOptions,
  UpsertedContact
} from '../types/contacts'

/** Contacts, addressed by email address. */
export class Contacts {
  constructor(private readonly transport: Transport) {}

  /**
   * Creates the contact, or updates the one with this email (HTTP 200 instead of
   * 201), then subscribes it to `listIds`; each list reports its own outcome.
   */
  create(
    payload: CreateContactOptions,
    options: RequestOptions = {}
  ): Promise<NulistResponse<UpsertedContact>> {
    return this.transport.post<UpsertedContact, CreateContactOptions>(
      RequestPath.of('/contacts'),
      payload,
      options
    )
  }

  get(email: string, options: RequestOptions = {}): Promise<NulistResponse<Contact>> {
    return this.transport.get<Contact>(RequestPath.of('/contacts/{email}', { email }), options)
  }

  /** Newest first unless `sort` says otherwise. */
  list(
    params: ListContactsOptions = {},
    options: RequestOptions = {}
  ): Promise<NulistResponse<Page<ContactSummary>>> {
    return this.transport.get<Page<ContactSummary>>(RequestPath.of('/contacts'), {
      ...options,
      query: {
        page: params.page,
        pageSize: params.pageSize,
        q: params.q,
        status: params.status,
        listId: params.listId,
        sort: params.sort
      }
    })
  }

  update(
    email: string,
    payload: UpdateContactOptions,
    options: RequestOptions = {}
  ): Promise<NulistResponse<Contact>> {
    return this.transport.patch<Contact, UpdateContactOptions>(
      RequestPath.of('/contacts/{email}', { email }),
      payload,
      options
    )
  }

  /** Deletes the contact and its subscriptions. */
  remove(
    email: string,
    options: RequestOptions = {}
  ): Promise<NulistResponse<DeletedResource<'contact'>>> {
    return this.transport.delete<DeletedResource<'contact'>>(
      RequestPath.of('/contacts/{email}', { email }),
      options
    )
  }

  /** From one list (`listId`), or from every email when it is omitted. */
  unsubscribe(
    email: string,
    payload: UnsubscribeContactOptions = {},
    options: RequestOptions = {}
  ): Promise<NulistResponse<Contact>> {
    return this.transport.post<Contact, UnsubscribeContactOptions>(
      RequestPath.of('/contacts/{email}/unsubscribe', { email }),
      payload,
      options
    )
  }
}
