import type { ErrorResponse } from './errors'

/** Response headers, lower-cased (`ratelimit-remaining`, `idempotent-replayed`…). */
export type ResponseHeaders = Record<string, string>

export interface MlistSuccess<T> {
  data: T
  error: null
}

export interface MlistFailure {
  data: null
  error: ErrorResponse
}

/**
 * What every SDK method resolves to. HTTP errors, network failures and aborts
 * are returned in `error`, never thrown; `headers` is null when no response was received.
 */
export type MlistResponse<T> = (MlistSuccess<T> | MlistFailure) & {
  headers: ResponseHeaders | null
}
