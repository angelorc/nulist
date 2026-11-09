import { ZodError } from 'zod'
import { publicSubscribeSchema, signupTargetSchema } from '#shared/schemas/public'
import type { SignupFormStatus } from '#shared/schemas/public'
import { DomainError, RateLimitedError } from '../../lib/core/errors'
import { PublicSignup } from '../../lib/optin/PublicSignup'
import { SignupThrottle } from '../../lib/optin/SignupThrottle'

/** 5 signups per minute per client IP (shared by the hosted page and embedded forms). */
const throttle = new SignupThrottle({
  points: 5,
  durationSeconds: 60,
  keyPrefix: 'public-subscribe'
})

/**
 * Public signup into the organization that owns the list. JSON requests (hosted
 * page) get JSON; classic HTML form posts from embedded snippets are redirected
 * (303) to the hosted page's result state.
 */
export default definePublicHandler(async (event, { resolver, actor }) => {
  const isFormPost = (getRequestHeader(event, 'content-type') ?? '').includes(
    'application/x-www-form-urlencoded'
  )

  const body: unknown = await readBody(event).catch(() => undefined)
  const target = signupTargetSchema.safeParse(body)

  const redirectTo = (status: SignupFormStatus) =>
    sendRedirect(
      event,
      `/subscribe/${target.success ? target.data.listId : 'unknown'}?status=${status}`,
      303
    )

  try {
    await throttle.consume(actor.ip)
    const input = publicSubscribeSchema.parse(body ?? {})
    const signup = await PublicSignup.forList(resolver, input.listId)
    const result = await signup.signup(input, actor)

    if (isFormPost) return redirectTo(result.optIn === 'double' ? 'check-email' : 'subscribed')

    return result
  } catch (error) {
    if (error instanceof RateLimitedError)
      setResponseHeader(event, 'retry-after', error.retryAfterSeconds)

    if (isFormPost) {
      if (error instanceof RateLimitedError) return redirectTo('rate-limited')

      if (error instanceof ZodError) return redirectTo('invalid')

      if (!(error instanceof DomainError)) console.error('[subscribe] signup failed', error)

      return redirectTo('error')
    }

    throw error
  }
})
