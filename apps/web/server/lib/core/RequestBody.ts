import { readRawBody } from 'h3'
import type { H3Event } from 'h3'
import { DomainError } from './errors'

/** The request body is larger than the route accepts. */
export class PayloadTooLargeError extends DomainError {
  constructor() {
    super('The request body is too large.', 413, 'payload_too_large')
  }
}

/**
 * Where h3 caches a request body it has read (`Symbol.for('h3RawBody')`): readBody,
 * readRawBody and readMultipartFormData reuse it instead of reading the stream again.
 */
const H3_RAW_BODY = Symbol.for('h3RawBody')

const BODY_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Reads a request body with a byte limit enforced while streaming, whatever
 * Content-Length says (chunked requests have none): past the limit the request
 * is dropped instead of buffered. The body is then cached where h3's readers
 * find it, so route handlers keep using readBody / readMultipartFormData.
 */
export class RequestBodyLimit {
  constructor(private readonly maxBytes: number) {}

  async read(event: H3Event): Promise<Buffer> {
    if (!BODY_METHODS.has(event.method)) return Buffer.alloc(0)

    // Already read (and limited) earlier in this request.
    if (Reflect.has(event.node.req, H3_RAW_BODY))
      return (await readRawBody(event, false)) ?? Buffer.alloc(0)

    const declared = Number(event.node.req.headers['content-length'] ?? 0)

    if (declared > this.maxBytes) throw new PayloadTooLargeError()

    const body = await this.collect(event)
    Reflect.set(event.node.req, H3_RAW_BODY, Promise.resolve(body))

    return body
  }

  private async collect(event: H3Event): Promise<Buffer> {
    const chunks: Buffer[] = []
    let size = 0

    // Leaving the loop early (throw) destroys the request stream: nothing more is read.
    for await (const chunk of event.node.req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += bytes.length

      if (size > this.maxBytes) throw new PayloadTooLargeError()
      chunks.push(bytes)
    }

    return Buffer.concat(chunks)
  }
}
