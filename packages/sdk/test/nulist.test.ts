import { describe, expect, it } from 'vitest'
import { createClient, type Nulist } from '../src'
import type { FetchFunction, JsonInput } from '../src'

interface RecordedRequest {
  url: string
  init: RequestInit
}

type Reply = (init: RequestInit) => Promise<Response>

/** A `fetch` that records requests and answers with queued replies. */
class FakeFetch {
  readonly requests: RecordedRequest[] = []
  private readonly replies: Reply[] = []

  readonly fetch: FetchFunction = (url, init) => {
    this.requests.push({ url, init })
    const reply = this.replies.shift()

    return reply ? reply(init) : Promise.reject(new Error(`Unexpected request to ${url}`))
  }

  json(body: JsonInput, status = 200): this {
    return this.text(JSON.stringify(body), status, { 'content-type': 'application/json' })
  }

  text(body: string, status: number, headers: HeadersInit = {}): this {
    this.replies.push(async () => new Response(body, { status, headers }))

    return this
  }

  networkError(message: string): this {
    this.replies.push(async () => Promise.reject(new TypeError(message)))

    return this
  }

  /** Never answers; rejects like fetch once the request's signal aborts. */
  hang(): this {
    this.replies.push(
      async (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        })
    )

    return this
  }

  get last(): RecordedRequest {
    const request = this.requests.at(-1)

    if (!request) throw new Error('fetch was not called')

    return request
  }

  get lastHeaders(): Headers {
    return new Headers(this.last.init.headers)
  }
}

function client(fake: FakeFetch, userAgent?: string): Nulist {
  return createClient('ml_test_key', {
    baseUrl: 'https://mail.test/api/v1/',
    fetch: fake.fetch,
    userAgent
  })
}

const EMAIL = {
  id: '0b6c2f3e-8a51-4f3e-9d0a-6f1c2b3a4d5e',
  object: 'email',
  status: 'queued'
}

describe('error normalisation', () => {
  it('unwraps the API error body and keeps the response headers', async () => {
    const fake = new FakeFetch().json(
      {
        error: {
          code: 'validation_error',
          message: 'to: Enter a valid email address',
          details: { issues: [{ path: 'to', message: 'Enter a valid email address' }] }
        }
      },
      422
    )

    const result = await client(fake).emails.send({ to: 'nope', subject: 'Hi', html: '<p>Hi</p>' })

    expect(result).toEqual({
      data: null,
      error: {
        name: 'validation_error',
        message: 'to: Enter a valid email address',
        statusCode: 422,
        details: { issues: [{ path: 'to', message: 'Enter a valid email address' }] }
      },
      headers: { 'content-type': 'application/json' }
    })
  })

  it('passes an unknown API code through and maps a non-JSON proxy page to application_error', async () => {
    const fake = new FakeFetch()
      .json({ error: { code: 'brand_new_code', message: 'Something new' } }, 409)
      .text('<html><body>502 Bad Gateway</body></html>', 502, { 'content-type': 'text/html' })

    const nulist = client(fake)
    const unknown = await nulist.lists.get('4d0a8a8e-7f43-4b0e-a8a2-1e5b3c9d7f60')
    const proxy = await nulist.lists.get('4d0a8a8e-7f43-4b0e-a8a2-1e5b3c9d7f60')

    expect(unknown.error).toEqual({
      name: 'brand_new_code',
      message: 'Something new',
      statusCode: 409
    })

    expect(proxy).toMatchObject({
      data: null,
      error: { name: 'application_error', statusCode: 502 },
      headers: { 'content-type': 'text/html' }
    })
  })

  it('returns network failures instead of throwing', async () => {
    const fake = new FakeFetch().networkError('getaddrinfo ENOTFOUND mail.test')

    const result = await client(fake).contacts.get('ada@example.com')

    expect(result).toEqual({
      data: null,
      error: {
        name: 'application_error',
        message: 'Unable to reach the nulist API: getaddrinfo ENOTFOUND mail.test.',
        statusCode: null
      },
      headers: null
    })
  })

  it('returns an abort by the caller instead of rejecting', async () => {
    const fake = new FakeFetch().hang()
    const controller = new AbortController()
    const pending = client(fake).emails.get(EMAIL.id, { signal: controller.signal })
    controller.abort(new Error('caller gave up'))

    await expect(pending).resolves.toEqual({
      data: null,
      error: {
        name: 'request_aborted',
        message: 'The request was aborted: caller gave up.',
        statusCode: null
      },
      headers: null
    })
  })
})

describe('request headers', () => {
  it('sends the key, user agent, JSON content type and idempotency key', async () => {
    const fake = new FakeFetch().json(EMAIL, 202)

    const { data } = await client(fake, 'billing-service/2.1').emails.send(
      { to: 'ada@example.com', template: 'welcome', data: { plan: 'pro' } },
      {
        idempotencyKey: 'welcome/ada',
        headers: { Authorization: 'Bearer stolen', 'X-Trace': 't-1' }
      }
    )

    expect(data).toEqual(EMAIL)
    expect(fake.last.url).toBe('https://mail.test/api/v1/emails')
    expect(fake.last.init.method).toBe('POST')
    expect(fake.last.init.body).toBe(
      '{"to":"ada@example.com","template":"welcome","data":{"plan":"pro"}}'
    )

    expect(Object.fromEntries(fake.lastHeaders)).toEqual({
      accept: 'application/json',
      authorization: 'Bearer ml_test_key',
      'content-type': 'application/json',
      'idempotency-key': 'welcome/ada',
      'user-agent': 'billing-service/2.1',
      'x-trace': 't-1'
    })
  })

  it('sends no body and no content type on reads, and accepts a Headers instance', async () => {
    const fake = new FakeFetch().json(EMAIL)

    await client(fake).emails.get(EMAIL.id, { headers: new Headers({ 'X-Trace': 't-2' }) })

    expect(fake.last.init.body).toBeUndefined()
    expect(fake.lastHeaders.has('content-type')).toBe(false)
    expect(fake.lastHeaders.get('x-trace')).toBe('t-2')
    expect(fake.lastHeaders.get('user-agent')).toMatch(/^nulist-node:\d+\.\d+\.\d+/)
  })
})

describe('query and path encoding', () => {
  it('encodes filters and skips the ones left out', async () => {
    const fake = new FakeFetch().json({
      object: 'list',
      data: [],
      page: 2,
      pageSize: 10,
      total: 0,
      hasMore: false
    })

    await client(fake).contacts.list({
      page: 2,
      pageSize: 10,
      q: 'ada lovelace+1',
      status: undefined,
      sort: '-email'
    })

    expect(fake.last.url).toBe(
      'https://mail.test/api/v1/contacts?page=2&pageSize=10&q=ada+lovelace%2B1&sort=-email'
    )
  })

  it('percent-encodes path parameters', async () => {
    const fake = new FakeFetch().json({ id: 'c1', object: 'contact', deleted: true })

    await client(fake).contacts.remove('ada+news/2026@example.com')

    expect(fake.last.url).toBe('https://mail.test/api/v1/contacts/ada%2Bnews%2F2026%40example.com')
    expect(fake.last.init.method).toBe('DELETE')
  })

  it('refuses empty and dot-segment parameters without sending a request', async () => {
    const fake = new FakeFetch()
    const nulist = client(fake)

    const dots = await nulist.templates.update('..', { name: 'Escaped' })
    const empty = await nulist.broadcasts.send('  ', {})

    expect(dots).toEqual({
      data: null,
      error: {
        name: 'invalid_parameter',
        message: '`id` cannot be `.` or `..`.',
        statusCode: null
      },
      headers: null
    })

    expect(empty.error).toEqual({
      name: 'missing_required_field',
      message: 'Missing `id`.',
      statusCode: null
    })
    expect(fake.requests).toHaveLength(0)
  })
})
