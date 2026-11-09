import { z } from 'zod'

/**
 * The parts of a failed request (ofetch FetchError, NuxtError from useFetch, or a plain Error)
 * that carry a client-safe message produced by server/utils/api.ts.
 */
const apiFailureSchema = z.object({
  data: z
    .object({
      message: z.string().optional(),
      data: z.object({ message: z.string().optional() }).nullish()
    })
    .nullish()
    .catch(null),
  statusMessage: z.string().optional().catch(undefined),
  message: z.string().optional().catch(undefined)
})

/** Extracts the client-safe message produced by server/utils/api.ts. */
export function apiErrorMessage(cause: unknown): string {
  const parsed = apiFailureSchema.safeParse(cause)

  if (!parsed.success) return 'Something went wrong'

  const failure = parsed.data

  return (
    failure.data?.message ??
    failure.data?.data?.message ??
    failure.statusMessage ??
    failure.message ??
    'Something went wrong'
  )
}

/** Toast titles of {@link useApiAction}. */
export interface ApiActionOptions<R> {
  /** Success toast title, fixed or computed from the result. No toast when omitted. */
  success?: string | ((result: R) => string)
  /** Error toast title; the description is the server's message. */
  error?: string
}

/**
 * Wraps a mutation with pending state and toasts (through {@link useNotify}).
 * Errors are shown and swallowed; the wrapped function returns undefined on failure.
 */
export function useApiAction<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  options: ApiActionOptions<R> = {}
) {
  const notify = useNotify()
  const pending = ref(false)

  /** Distinguishes a fixed success message from one computed from the result. */
  function isStaticMessage(message: string | ((result: R) => string)): message is string {
    return z.string().safeParse(message).success
  }

  async function run(...args: A): Promise<R | undefined> {
    pending.value = true

    try {
      const result = await fn(...args)

      const message =
        options.success === undefined || isStaticMessage(options.success)
          ? options.success
          : options.success(result)

      if (message) notify.success(message)

      return result
    } catch (error) {
      notify.error(options.error ?? 'Action failed', error)

      return undefined
    } finally {
      pending.value = false
    }
  }

  return { run, pending }
}
