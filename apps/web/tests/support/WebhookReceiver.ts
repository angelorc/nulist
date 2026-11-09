import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import type { WebhookUnbrandedRequiredHeaders } from 'standardwebhooks'
import { z } from 'zod'

/** One webhook request as the customer's endpoint received it. */
export interface ReceivedWebhook {
  body: string
  headers: WebhookUnbrandedRequiredHeaders
}

/** What `server.address()` returns while listening on TCP. */
const tcpAddressSchema = z.object({ port: z.number().int().positive() })

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name]

  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

/** A customer's webhook endpoint on localhost: answers 204 and keeps every request. */
export class WebhookReceiver {
  readonly received: ReceivedWebhook[] = []

  private constructor(private readonly server: Server) {}

  static async start(): Promise<WebhookReceiver> {
    const server = createServer()
    const receiver = new WebhookReceiver(server)

    server.on('request', (request, response) => {
      const chunks: Buffer[] = []

      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        receiver.received.push({
          body: Buffer.concat(chunks).toString('utf8'),
          headers: {
            'webhook-id': header(request, 'webhook-id'),
            'webhook-timestamp': header(request, 'webhook-timestamp'),
            'webhook-signature': header(request, 'webhook-signature')
          }
        })
        response.writeHead(204).end()
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    return receiver
  }

  get url(): string {
    const { port } = tcpAddressSchema.parse(this.server.address())

    return `http://127.0.0.1:${port}/webhooks`
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve()))
    )
  }
}
