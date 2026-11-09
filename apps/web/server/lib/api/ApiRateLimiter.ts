import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'
import { RateLimitedError } from '../core/errors'

/** Values for the IETF `RateLimit-*` response headers. */
export interface RateLimitState {
  /** Requests allowed per window. */
  limit: number
  remaining: number
  /** Seconds until the window resets. */
  resetSeconds: number
}

export class ApiRateLimitExceededError extends RateLimitedError {
  constructor(readonly state: RateLimitState) {
    super(Math.max(1, state.resetSeconds))
    this.message = `Rate limit of ${state.limit} requests per minute exceeded. Retry in ${Math.max(1, state.resetSeconds)}s.`
  }
}

const WINDOW_SECONDS = 60

/**
 * Per-key fixed one-minute window backed by rate-limiter-flexible.
 * The limit comes from Settings → Limits on every call; changing it starts a
 * fresh window. In-memory: one budget per server process.
 */
export class ApiRateLimiter {
  /** One limiter per budget: organizations may have different limits. */
  private readonly limiters = new Map<number, RateLimiterMemory>()

  private limiterFor(points: number): RateLimiterMemory {
    let limiter = this.limiters.get(points)

    if (!limiter) {
      limiter = new RateLimiterMemory({
        points,
        duration: WINDOW_SECONDS,
        keyPrefix: `api_v1_${points}`
      })
      this.limiters.set(points, limiter)
    }

    return limiter
  }

  /**
   * Consumes one request for `key`. Returns null when unlimited (`perMinute` = 0),
   * otherwise the state after this request; throws ApiRateLimitExceededError when over budget.
   */
  async consume(key: string, perMinute: number): Promise<RateLimitState | null> {
    if (!perMinute || perMinute <= 0) return null
    const limiter = this.limiterFor(perMinute)

    try {
      const res = await limiter.consume(key)

      return this.toState(perMinute, res)
    } catch (error) {
      if (error instanceof RateLimiterRes)
        throw new ApiRateLimitExceededError(this.toState(perMinute, error))
      throw error
    }
  }

  private toState(limit: number, res: RateLimiterRes): RateLimitState {
    return {
      limit,
      remaining: Math.max(0, res.remainingPoints),
      resetSeconds: Math.max(0, Math.ceil(res.msBeforeNext / 1000))
    }
  }
}
