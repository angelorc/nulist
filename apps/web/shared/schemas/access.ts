import { z } from 'zod'

const DOMAIN_ERROR = 'Enter a domain like mycompany.com'

export const allowedDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^@/, ''))
  .pipe(z.hostname(DOMAIN_ERROR).refine((value) => value.includes('.'), DOMAIN_ERROR))

export const accessSettingsSchema = z.object({
  allowedDomains: z
    .array(allowedDomainSchema)
    .max(100)
    .transform((domains) => [...new Set(domains)])
})

export type AccessSettingsInput = z.input<typeof accessSettingsSchema>

export type AccessSettings = z.output<typeof accessSettingsSchema>

export const SIGN_IN_ERROR_CODES = {
  invitationRequired: 'invitation_required',
  domainNotAllowed: 'email_domain_not_allowed',
  emailNotVerified: 'email_not_verified'
} as const

const SIGN_IN_ERROR_MESSAGES = new Map<string, string>([
  [
    SIGN_IN_ERROR_CODES.invitationRequired,
    'This instance is invitation only. Open the link in your invitation email and continue with the invited Google account.'
  ],
  [
    SIGN_IN_ERROR_CODES.domainNotAllowed,
    'Your email domain is not allowed to sign in to this instance.'
  ],
  [SIGN_IN_ERROR_CODES.emailNotVerified, 'Your Google account email is not verified.'],
  ['account_not_linked', 'This Google account could not be linked to your existing account.'],
  ['unable_to_link_account', 'This Google account could not be linked to your existing account.'],
  ['access_denied', 'Google sign-in was canceled.']
])

export const signInErrorSchema = z
  .string()
  .min(1)
  .transform((code) => SIGN_IN_ERROR_MESSAGES.get(code) ?? 'Google sign-in failed. Try again.')

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@')

  return at < 0
    ? ''
    : email
        .slice(at + 1)
        .trim()
        .toLowerCase()
}
