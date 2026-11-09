/** Confirms SNS HTTPS subscriptions by visiting their SubscribeURL. */
export interface SubscriptionConfirmer {
  confirm(subscribeUrl: string): Promise<void>
}

export class UntrustedSubscribeUrlError extends Error {
  constructor() {
    super('SubscribeURL does not point to an Amazon SNS endpoint')
    this.name = 'UntrustedSubscribeUrlError'
  }
}

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/
const TIMEOUT_MS = 10_000

/**
 * Only ever requests https://sns.<region>.amazonaws.com(.cn) URLs, so a
 * forged confirmation can never make the server call an arbitrary host.
 */
export class SnsSubscriptionConfirmer implements SubscriptionConfirmer {
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch) {}

  static isTrusted(url: string): boolean {
    try {
      const parsed = new URL(url)

      return (
        parsed.protocol === 'https:' &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port &&
        SNS_HOST.test(parsed.hostname)
      )
    } catch {
      return false
    }
  }

  async confirm(subscribeUrl: string): Promise<void> {
    if (!SnsSubscriptionConfirmer.isTrusted(subscribeUrl)) throw new UntrustedSubscribeUrlError()

    const response = await this.fetcher(subscribeUrl, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })

    if (!response.ok)
      throw new Error(`SNS answered ${response.status} to the subscription confirmation`)
  }
}
