import type { IdempotentRequestOptions, RequestOptions } from './request-options'
import type { QueryParameters, RequestPath } from './request-path'
import type { MlistResponse } from './response'

export interface QueryRequestOptions extends RequestOptions {
  query?: QueryParameters
}

/**
 * How resources reach the API. `HttpClient` is the implementation; resources
 * only depend on this contract, so tests and wrappers can provide their own.
 * `payload` is serialized as the JSON request body (omitted when undefined).
 */
export interface Transport {
  get<T>(path: RequestPath, options?: QueryRequestOptions): Promise<MlistResponse<T>>
  post<T, P = undefined>(
    path: RequestPath,
    payload?: P,
    options?: IdempotentRequestOptions
  ): Promise<MlistResponse<T>>
  patch<T, P>(path: RequestPath, payload: P, options?: RequestOptions): Promise<MlistResponse<T>>
  delete<T>(path: RequestPath, options?: RequestOptions): Promise<MlistResponse<T>>
}
