import { z } from 'zod'
import type { ContactStatus, OptInMode } from '../types/domain'
import { contactEmailSchema } from './contacts'

/** Signed recipient token (compact JWS) carried by confirm / preference / web-view links. */
export const recipientTokenSchema = z
  .string()
  .trim()
  .min(20, 'This link is invalid')
  .max(4096, 'This link is invalid')
  .regex(/^[\w-]+\.[\w-]+\.[\w-]+$/, 'This link is invalid')

export const recipientTokenParamsSchema = z.object({ token: recipientTokenSchema })

export const confirmSubscriptionSchema = z.object({ token: recipientTokenSchema })

export const preferencesUpdateSchema = z
  .object({
    lists: z.record(z.uuid(), z.boolean()).default({}),
    topics: z.record(z.uuid(), z.boolean()).default({})
  })
  .refine(
    (v) => Object.keys(v.lists).length + Object.keys(v.topics).length <= 200,
    'Too many changes at once'
  )

export type PreferencesUpdateInput = z.input<typeof preferencesUpdateSchema>

export type PreferencesUpdate = z.output<typeof preferencesUpdateSchema>

const optionalName = z
  .string()
  .trim()
  .max(100, 'Keep it under 100 characters')
  .optional()
  .transform((v) => v || undefined)

/** Hosted / embedded signup form. `website` is a honeypot that humans never fill. */
export const publicSubscribeSchema = z.object({
  listId: z.uuid('This signup form is not available'),
  email: contactEmailSchema,
  firstName: optionalName,
  lastName: optionalName,
  website: z.string().max(500).optional()
})

export type PublicSubscribeInput = z.input<typeof publicSubscribeSchema>

export type PublicSubscribeData = z.output<typeof publicSubscribeSchema>

/** Fields the hosted form validates on the client (listId and honeypot are added on submit). */
export const signupFormSchema = publicSubscribeSchema.pick({ email: true, firstName: true })

export type SignupFormInput = z.input<typeof signupFormSchema>

export const publicListParamsSchema = z.object({ id: z.uuid() })

/** The list a signup form posts to, read before the full body is validated (for redirects). */
export const signupTargetSchema = z.object({ listId: z.uuid() })

/** Success states of the hosted signup page (`?status=` after an embedded form post). */
export const signupOutcomeSchema = z.enum(['check-email', 'subscribed'])

export type SignupOutcome = z.infer<typeof signupOutcomeSchema>

/** Failure states of the hosted signup page (`?status=` after an embedded form post). */
export const signupIssueSchema = z.enum(['invalid', 'rate-limited', 'error'])

export type SignupIssue = z.infer<typeof signupIssueSchema>

/** Every `?status=` an embedded HTML form is redirected (303) to. */
export type SignupFormStatus = SignupOutcome | SignupIssue

/**
 * A failed request to a public endpoint as the browser sees it (ofetch FetchError
 * or NuxtError): HTTP status and the DomainError payload under `data.data`.
 */
export const publicFailureSchema = z.object({
  statusCode: z.number().int().optional(),
  data: z
    .object({
      data: z
        .object({
          code: z.string().optional(),
          message: z.string().optional(),
          listId: z.uuid().nullish()
        })
        .optional()
    })
    .optional()
})

/** What a recipient page needs to know about a failed public request. */
export interface PublicFailure {
  status: number | null
  code: string | null
  message: string | null
  /** The list to sign up to again (expired opt-in links of public lists). */
  listId: string | null
}

/** Parses a thrown fetch error into a PublicFailure (unknown shapes become a network failure). */
export function parsePublicFailure(cause: unknown): PublicFailure {
  const parsed = publicFailureSchema.safeParse(cause)
  const payload = parsed.success ? parsed.data.data?.data : undefined

  return {
    status: parsed.success ? (parsed.data.statusCode ?? null) : null,
    code: payload?.code ?? null,
    message: payload?.message ?? null,
    listId: payload?.listId ?? null
  }
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------
/**
 * Branding of the organization behind a recipient page (Settings → General and
 * the organization logo). Every public payload carries its own, so pages never
 * show another organization's name.
 */
export interface PublicBrand {
  appName: string
  companyName: string
  companyAddress: string
  /** Organization logo URL. */
  logo: string | null
}

/** Shown when no organization is known (invalid or expired links, network errors). */
export const NEUTRAL_PUBLIC_BRAND: Readonly<PublicBrand> = Object.freeze({
  appName: 'mlist',
  companyName: '',
  companyAddress: '',
  logo: null
})

export interface PublicListInfo {
  id: string
  name: string
  description: string | null
  optIn: OptInMode
  brand: PublicBrand
}

/** Always the same for a given list: never reveals whether the address was already known. */
export interface PublicSignupResult {
  ok: true
  optIn: OptInMode
}

export type ConfirmationState = 'pending' | 'confirmed' | 'expired'

export interface ConfirmationPreview {
  state: ConfirmationState
  email: string
  list: { id: string; name: string; description: string | null }
  /** The list accepts new signups from the hosted form (shown when the link expired). */
  canSignUpAgain: boolean
  brand: PublicBrand
}

export interface ConfirmationResult {
  listId: string
  listName: string
  alreadyConfirmed: boolean
}

export interface PreferenceList {
  id: string
  name: string
  description: string | null
  optIn: OptInMode
  /** Confirmed or awaiting confirmation. */
  subscribed: boolean
  /** Waiting for the double opt-in confirmation click. */
  pending: boolean
  /** The email this link came from was sent to this list. */
  inScope: boolean
  /** Private lists can be left but not joined from the preference center. */
  canJoin: boolean
}

export interface PreferenceTopic {
  id: string
  name: string
  description: string | null
  subscribed: boolean
}

export interface PublicPreferences {
  /** Partially masked address, e.g. `ja•••@example.com`. */
  email: string
  status: ContactStatus
  canResubscribe: boolean
  lists: PreferenceList[]
  topics: PreferenceTopic[]
  brand: PublicBrand
}

export interface WebViewMeta {
  subject: string
  from: string
  sentAt: string | null
  preferencesUrl: string | null
}
