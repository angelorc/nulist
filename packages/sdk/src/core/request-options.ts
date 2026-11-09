/**
 * Extra request headers: a record, or `[name, value]` pairs (a `Headers` instance is one).
 * Declared by the SDK so that its types do not need the DOM library (`HeadersInit`).
 */
export type HeadersInput = Readonly<Record<string, string>> | Iterable<readonly [string, string]>

/** Per-call options accepted by every SDK method. */
export interface RequestOptions {
  /** Extra headers (e.g. tracing); they override the SDK defaults except `Authorization`. */
  headers?: HeadersInput
  /** Aborting resolves the call with a `request_aborted` error (it never rejects). */
  signal?: AbortSignal
}

/** Options of the calls the API deduplicates with an `Idempotency-Key` (sending emails). */
export interface IdempotentRequestOptions extends RequestOptions {
  /**
   * Sent as the `Idempotency-Key` header (1-256 characters, kept 24 hours). A retry
   * with the same key and body replays the first result (`idempotent-replayed: true`);
   * the same key with a different body fails with `invalid_idempotent_request`.
   */
  idempotencyKey?: string
}
