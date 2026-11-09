import { request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockedTargetError, OutboundTargetPolicy } from './OutboundTargetPolicy'

export interface OutboundRequest {
  headers: Readonly<Record<string, string>>
  body: string
  timeoutMs: number
  /** Response bytes kept; the rest of the body is never read. */
  maxResponseBytes: number
}

export interface OutboundResponse {
  status: number
  /** The first `maxResponseBytes` of the body (UTF-8). */
  body: string
  retryAfter: string | null
}

/**
 * HTTP client for organization-configured URLs (outbound webhooks): every
 * connection goes through the OutboundTargetPolicy (checked before and at
 * connect time), redirects are not followed, the request is bounded by a
 * timeout and only the head of the response body is read.
 */
export class OutboundHttpClient {
  constructor(private readonly policy: OutboundTargetPolicy) {}

  async post(url: string, init: OutboundRequest): Promise<OutboundResponse> {
    const parsed = new URL(url)
    const target = OutboundTargetPolicy.targetOf(parsed)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      throw new BlockedTargetError(target.host)
    await this.policy.assertAllowed(target)

    const send = parsed.protocol === 'https:' ? httpsRequest : httpRequest

    return new Promise<OutboundResponse>((resolve, reject) => {
      const request = send(
        parsed,
        {
          method: 'POST',
          headers: { ...init.headers, 'content-length': String(Buffer.byteLength(init.body)) },
          lookup: this.policy.lookupFor(target),
          signal: AbortSignal.timeout(init.timeoutMs)
        },
        (response) => {
          resolve(OutboundHttpClient.readHead(response, init.maxResponseBytes))
        }
      )

      request.on('error', reject)
      request.end(init.body)
    })
  }

  /** Reads at most `maxBytes` of the body, then drops the connection. */
  private static readHead(response: IncomingMessage, maxBytes: number): Promise<OutboundResponse> {
    const retryAfter = response.headers['retry-after']

    // The status is known once headers arrived: a body cut short (timeout, reset) still answers.
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let size = 0

      const finish = () =>
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8'),
          retryAfter: retryAfter ?? null
        })

      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        size += chunk.length

        if (size >= maxBytes) {
          response.destroy()
          finish()
        }
      })
      response.on('end', finish)
      response.on('error', finish)
      response.on('close', finish)
    })
  }
}
