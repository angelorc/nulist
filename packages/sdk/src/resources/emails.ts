import type { IdempotentRequestOptions, RequestOptions } from '../core/request-options'
import { RequestPath } from '../core/request-path'
import type { MlistResponse } from '../core/response'
import type { Transport } from '../core/transport'
import type { Page } from '../types/common'
import type {
  Email,
  EmailBatch,
  EmailDetail,
  ListEmailsOptions,
  SendEmailOptions
} from '../types/emails'

/** `/emails/batch`: up to 100 emails, validated as a whole before anything is queued. */
export class Batch {
  constructor(private readonly transport: Transport) {}

  /** One invalid email rejects the batch; `error.message` names its index (`emails[3]: …`). */
  send(
    emails: SendEmailOptions[],
    options: IdempotentRequestOptions = {}
  ): Promise<MlistResponse<EmailBatch>> {
    return this.transport.post<EmailBatch, SendEmailOptions[]>(
      RequestPath.of('/emails/batch'),
      emails,
      options
    )
  }

  /** Alias of `send`. */
  create(
    emails: SendEmailOptions[],
    options: IdempotentRequestOptions = {}
  ): Promise<MlistResponse<EmailBatch>> {
    return this.send(emails, options)
  }
}

/** Transactional emails: one recipient each, from a template or raw HTML. */
export class Emails {
  readonly batch: Batch

  constructor(private readonly transport: Transport) {
    this.batch = new Batch(transport)
  }

  /** Queues an email (HTTP 202); a replayed `idempotencyKey` returns the first email (HTTP 200). */
  send(
    payload: SendEmailOptions,
    options: IdempotentRequestOptions = {}
  ): Promise<MlistResponse<Email>> {
    return this.transport.post<Email, SendEmailOptions>(RequestPath.of('/emails'), payload, options)
  }

  /** Alias of `send`. */
  create(
    payload: SendEmailOptions,
    options: IdempotentRequestOptions = {}
  ): Promise<MlistResponse<Email>> {
    return this.send(payload, options)
  }

  get(id: string, options: RequestOptions = {}): Promise<MlistResponse<EmailDetail>> {
    return this.transport.get<EmailDetail>(RequestPath.of('/emails/{id}', { id }), options)
  }

  /** Newest first. */
  list(
    params: ListEmailsOptions = {},
    options: RequestOptions = {}
  ): Promise<MlistResponse<Page<Email>>> {
    return this.transport.get<Page<Email>>(RequestPath.of('/emails'), {
      ...options,
      query: { page: params.page, pageSize: params.pageSize, status: params.status }
    })
  }

  /** Only `scheduled` emails can be cancelled (`invalid_state` otherwise). */
  cancel(id: string, options: RequestOptions = {}): Promise<MlistResponse<Email>> {
    return this.transport.post<Email>(
      RequestPath.of('/emails/{id}/cancel', { id }),
      undefined,
      options
    )
  }
}
