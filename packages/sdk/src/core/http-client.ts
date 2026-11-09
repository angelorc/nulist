import { ErrorResponses } from './errors'
import type { ErrorResponse } from './errors'
import { parseJson } from './json'
import type { HeadersInput, IdempotentRequestOptions, RequestOptions } from './request-options'
import type { RequestPath } from './request-path'
import type { MlistResponse, ResponseHeaders } from './response'
import type { QueryRequestOptions, Transport } from './transport'

/** The part of `fetch` the SDK uses; the global `fetch` satisfies it. */
export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>

export interface HttpClientConfig {
  /** Base of every path, e.g. `https://mail.example.com/api/v1`. */
  readonly apiUrl: string
  readonly apiKey: string
  readonly userAgent: string
  readonly fetch: FetchFunction
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/** One call: where it goes, how to serialize its body and the caller's options. */
interface Outgoing {
  readonly method: HttpMethod
  readonly path: RequestPath
  readonly target: string
  /** The JSON body (`undefined` for none); throws for values JSON cannot represent. */
  readonly body: () => string | undefined
  readonly options: IdempotentRequestOptions
}

/** Request headers by lower-cased name (a plain object: every `fetch` accepts one). */
type OutgoingHeaders = Record<string, string>

/** A request ready for `fetch`, or why it cannot be sent. */
type Prepared =
  | { readonly ok: true; readonly init: RequestInit }
  | { readonly ok: false; readonly error: ErrorResponse }

/** Why a request got no (complete) response, for the error message. */
function describe(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : 'the request failed'
}

/** Header pairs are iterable (arrays, `Headers`); records are not. */
function isHeaderPairs(input: HeadersInput): input is Iterable<readonly [string, string]> {
  return Symbol.iterator in input
}

function headerEntries(input: HeadersInput | undefined): Iterable<readonly [string, string]> {
  if (input === undefined) return []

  return isHeaderPairs(input) ? input : Object.entries(input)
}

/** Response headers with lower-cased names (`forEach` is part of every fetch's `Headers`). */
function responseHeaders(response: Response): ResponseHeaders {
  const headers: ResponseHeaders = {}

  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value
  })

  return headers
}

function failure(error: ErrorResponse, headers: ResponseHeaders | null): MlistResponse<never> {
  return { data: null, error, headers }
}

/**
 * Sends API requests with `fetch` and resolves every outcome to
 * `{ data, error, headers }`: API errors are unwrapped from their JSON body;
 * network failures, non-JSON answers and aborts become client errors. It never
 * rejects, and it only needs `fetch` (no `Headers` or other runtime globals).
 */
export class HttpClient implements Transport {
  constructor(private readonly config: HttpClientConfig) {}

  get<T>(path: RequestPath, options: QueryRequestOptions = {}): Promise<MlistResponse<T>> {
    return this.send<T>({
      method: 'GET',
      path,
      target: path.withQuery(options.query),
      body: () => undefined,
      options
    })
  }

  post<T, P = undefined>(
    path: RequestPath,
    payload?: P,
    options: IdempotentRequestOptions = {}
  ): Promise<MlistResponse<T>> {
    return this.send<T>({
      method: 'POST',
      path,
      target: path.value,
      body: () => (payload === undefined ? undefined : JSON.stringify(payload)),
      options
    })
  }

  patch<T, P>(
    path: RequestPath,
    payload: P,
    options: RequestOptions = {}
  ): Promise<MlistResponse<T>> {
    return this.send<T>({
      method: 'PATCH',
      path,
      target: path.value,
      body: () => JSON.stringify(payload),
      options
    })
  }

  delete<T>(path: RequestPath, options: RequestOptions = {}): Promise<MlistResponse<T>> {
    return this.send<T>({
      method: 'DELETE',
      path,
      target: path.value,
      body: () => undefined,
      options
    })
  }

  /** Defaults first, then the caller's headers (names lower-cased); the API key always wins. */
  private headers(options: IdempotentRequestOptions, hasBody: boolean): OutgoingHeaders {
    const headers = new Map([
      ['accept', 'application/json'],
      ['user-agent', this.config.userAgent]
    ])

    if (hasBody) headers.set('content-type', 'application/json')

    for (const [name, value] of headerEntries(options.headers))
      headers.set(name.toLowerCase(), value)

    if (options.idempotencyKey !== undefined) headers.set('idempotency-key', options.idempotencyKey)
    headers.set('authorization', `Bearer ${this.config.apiKey}`)

    return Object.fromEntries(headers)
  }

  /** Serializes the body and builds the headers; a body JSON cannot represent is refused. */
  private prepare(outgoing: Outgoing): Prepared {
    let body: string | undefined

    try {
      body = outgoing.body()
    } catch (cause) {
      return {
        ok: false,
        error: ErrorResponses.client(
          'invalid_parameter',
          `The request body cannot be sent as JSON: ${describe(cause)}.`
        )
      }
    }

    return {
      ok: true,
      init: {
        method: outgoing.method,
        headers: this.headers(outgoing.options, body !== undefined),
        body,
        signal: outgoing.options.signal
      }
    }
  }

  /** The error of a request that got no complete response (`status` once headers arrived). */
  private unanswered(
    cause: unknown,
    signal: AbortSignal | undefined,
    status: number | null
  ): ErrorResponse {
    if (signal?.aborted) {
      const reason = signal.reason instanceof Error ? `: ${signal.reason.message}` : ''

      return ErrorResponses.client('request_aborted', `The request was aborted${reason}.`, status)
    }

    return ErrorResponses.client(
      'application_error',
      status === null
        ? `Unable to reach the mlist API: ${describe(cause)}.`
        : `The mlist API response could not be read: ${describe(cause)}.`,
      status
    )
  }

  private async send<T>(outgoing: Outgoing): Promise<MlistResponse<T>> {
    if (outgoing.path.problem) return failure(outgoing.path.problem, null)
    const prepared = this.prepare(outgoing)

    if (!prepared.ok) return failure(prepared.error, null)
    const { signal } = outgoing.options
    let response: Response

    try {
      response = await this.config.fetch(`${this.config.apiUrl}${outgoing.target}`, prepared.init)
    } catch (cause) {
      return failure(this.unanswered(cause, signal, null), null)
    }

    const headers = responseHeaders(response)
    let text: string

    try {
      text = await response.text()
    } catch (cause) {
      return failure(this.unanswered(cause, signal, response.status), headers)
    }

    const body = parseJson(text)

    if (!response.ok)
      return failure(ErrorResponses.fromApi(body, response.status, response.statusText), headers)

    if (body === undefined) {
      return failure(
        ErrorResponses.client(
          'application_error',
          'The mlist API answered with a body that is not JSON.',
          response.status
        ),
        headers
      )
    }

    // SAFETY: a 2xx body of the mlist API is the resource the endpoint documents as `T`; the
    // SDK's response types are checked against the server's by apps/web/tests/contracts.
    return { data: body as T, error: null, headers }
  }
}
