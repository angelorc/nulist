const SCHEDULE_SECONDS = [5, 60, 600, 3_600, 14_400, 43_200] as const
const MAX_RETRY_AFTER_SECONDS = 86_400

/** Standard Webhooks retry schedule (~1 day in total). */
export class WebhookRetryPolicy {
  static isFinal(attempts: number): boolean {
    return attempts >= SCHEDULE_SECONDS.length
  }

  static exhausted(attempts: number): boolean {
    return attempts > SCHEDULE_SECONDS.length
  }

  static delaySeconds(attempts: number, retryAfter?: number): number {
    if (retryAfter !== undefined && retryAfter > 0)
      return Math.min(retryAfter, MAX_RETRY_AFTER_SECONDS)

    return SCHEDULE_SECONDS[Math.min(attempts, SCHEDULE_SECONDS.length - 1)] ?? 0
  }
}
