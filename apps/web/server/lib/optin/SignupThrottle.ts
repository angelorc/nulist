import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'
import { RateLimitedError } from '../core/errors'

export interface ThrottleOptions {
  /** Requests allowed per window. */
  points: number
  /** Window length in seconds. */
  durationSeconds: number
  keyPrefix?: string
}

/**
 * Per-key (client IP) fixed-window limiter for unauthenticated forms, backed by
 * rate-limiter-flexible. In-memory: one window per server process.
 */
export class SignupThrottle {
  private readonly limiter: RateLimiterMemory

  constructor(options: ThrottleOptions) {
    this.limiter = new RateLimiterMemory({
      points: options.points,
      duration: options.durationSeconds,
      keyPrefix: options.keyPrefix ?? 'signup'
    })
  }

  /** Consumes one point or throws RateLimitedError with the seconds to wait. */
  async consume(key: string | null | undefined): Promise<void> {
    try {
      await this.limiter.consume(key || 'unknown')
    } catch (error) {
      if (error instanceof RateLimiterRes)
        throw new RateLimitedError(Math.max(1, Math.ceil(error.msBeforeNext / 1000)))
      throw error
    }
  }
}
