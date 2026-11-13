import { apiKey } from '@better-auth/api-key'
import { defineServerAuth } from '@nuxtjs/better-auth/config'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { admin, organization } from 'better-auth/plugins'
import { count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { ac, roleLabel, roles } from '../shared/auth/permissions'
import { SIGN_IN_ERROR_CODES } from '../shared/schemas/access'
import * as authSchema from './db/auth-schema'
import { CLIENT_IP_HEADER } from './lib/security/ClientAddress'
import { SYSTEM_ACTOR } from './lib/core/actor'
import type { Actor } from './lib/core/actor'
import { requestActor } from './utils/api'
import { googleOAuthCredentials } from './utils/google-oauth'
import { useServices } from './utils/services'

/** Invitations stay valid for a week. */
const INVITATION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60

const instanceRoleSchema = z.object({ role: z.string().nullish() })

/** The instance role of a Better Auth user record (`admin` = instance administrator). */
function instanceRole(user: { id: string }): string | null {
  const parsed = instanceRoleSchema.safeParse(user)

  return parsed.success ? (parsed.data.role ?? null) : null
}

/**
 * Who triggered an organization hook: the signed-in user of the current request
 * (Nitro async context), else `fallback` (the user Better Auth reports), else the system.
 */
async function hookActor(fallback?: { id: string; email: string }): Promise<Actor> {
  let event: ReturnType<typeof useEvent> | null = null

  try {
    event = useEvent()
  } catch {
    event = null
  }

  const session = event ? await getRequestSession(event).catch(() => null) : null
  const user = session?.user ?? fallback

  if (!user) return SYSTEM_ACTOR

  const base = { type: 'user' as const, id: user.id, label: user.email }

  return event ? requestActor(event, base) : { ...base, organizationId: null }
}

function refuse(code: string, message: string): APIError {
  return APIError.from('FORBIDDEN', { code, message })
}

/** Logs hook failures: the Better Auth operation already succeeded. */
async function bestEffort(what: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (cause) {
    console.error(`[auth] ${what} failed`, cause)
  }
}

/**
 * Better Auth (via @nuxtjs/better-auth): Google sign-in sessions, instance
 * roles (admin plugin), organizations with our roles and access control, and
 * organization-owned API keys for the public REST API. Keep plugins in sync
 * with app/auth.config.ts and scripts/auth-cli.ts (schema generation).
 */
export default defineServerAuth(() => {
  const services = useServices()
  const { db } = services
  const google = googleOAuthCredentials()

  async function assertDomainAllowed(email: string): Promise<void> {
    if (!(await services.access.allows(email)))
      throw refuse(
        SIGN_IN_ERROR_CODES.domainNotAllowed,
        'Your email domain is not allowed to sign in to this instance.'
      )
  }

  return {
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    advanced: {
      database: { generateId: 'uuid' },
      // Set by server/middleware/client-address.ts: X-Forwarded-For only counts from trusted proxies.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] }
    },
    emailAndPassword: { enabled: import.meta.dev, minPasswordLength: 10 },
    socialProviders: {
      google: {
        enabled: google !== null,
        clientId: google?.clientId ?? '',
        clientSecret: google?.clientSecret ?? '',
        prompt: 'select_account'
      }
    },
    account: {
      accountLinking: {
        enabled: true,
        requireLocalEmailVerified: false
      }
    },
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    plugins: [
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
      organization({
        ac,
        roles,
        creatorRole: 'owner',
        allowUserToCreateOrganization: (user) => instanceRole(user) === 'admin',
        invitationExpiresIn: INVITATION_EXPIRES_IN_SECONDS,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async (data) => {
          const url = `${services.config.appUrl.replace(/\/+$/, '')}/invitations/${data.id}`

          await bestEffort('invitation email', async () => {
            const { outcome } = await services
              .forOrganization(data.organization.id)
              .systemMail.invitation({
                to: data.email,
                organizationName: data.organization.name,
                inviterName: data.inviter.user.name || data.inviter.user.email,
                roleLabel: roleLabel(data.role),
                url,
                expiresAt: data.invitation.expiresAt
              })

            if (outcome.status !== 'sent')
              console.error(`[auth] invitation email to ${data.email} was not sent`, outcome)
          })
        },
        organizationHooks: {
          beforeCreateInvitation: async ({ invitation }) => {
            await assertDomainAllowed(invitation.email)
          },
          afterCreateOrganization: async ({ organization: created, user }) => {
            await bestEffort('organization setup', async () => {
              await services.organizations.initialize(created.id, created.name)
              await services.organizationAudit.created(await hookActor(user), created)
            })
          },
          afterUpdateOrganization: async ({ organization: updated, user }) => {
            if (!updated) return
            await bestEffort('organization audit', async () => {
              await services.organizationAudit.updated(await hookActor(user), updated)
            })
          },
          // Uploaded files outlive the rows (and their public URLs stay reachable): purge the
          // organization's objects while its storage settings still exist. Never blocks deletion.
          beforeDeleteOrganization: async ({ organization: target, user }) => {
            await bestEffort('organization storage purge', async () => {
              const result = await services.forOrganization(target.id).files.purge()

              if (result.state === 'failed')
                console.error(`[auth] storage purge of ${result.prefix} failed: ${result.error}`)
              await services.organizationAudit.storagePurged(await hookActor(user), target, result)
            })
          },
          afterDeleteOrganization: async ({ organization: deleted, user }) => {
            services.evictOrganization(deleted.id)
            await bestEffort('organization API keys removal', async () => {
              await services.organizations.removeApiKeys(deleted.id)
            })
            await bestEffort('organization audit', async () => {
              await services.organizationAudit.deleted(await hookActor(user), deleted)
            })
          },
          afterAddMember: async ({ member, user, organization: target }) => {
            await bestEffort('member audit', async () => {
              await services.organizationAudit.memberAdded(
                await hookActor(),
                target,
                member,
                user.email
              )
            })
          },
          afterRemoveMember: async ({ member, user, organization: target }) => {
            await bestEffort('member audit', async () => {
              await services.organizationAudit.memberRemoved(
                await hookActor(),
                target,
                member,
                user.email
              )
            })
          },
          afterUpdateMemberRole: async ({ member, previousRole, user, organization: target }) => {
            await bestEffort('member audit', async () => {
              await services.organizationAudit.memberRoleUpdated(
                await hookActor(),
                target,
                member,
                previousRole,
                user.email
              )
            })
          },
          afterCreateInvitation: async ({ invitation, inviter, organization: target }) => {
            await bestEffort('invitation audit', async () => {
              await services.organizationAudit.invitation(
                await hookActor(inviter),
                target,
                invitation,
                'created'
              )
            })
          },
          afterAcceptInvitation: async ({ invitation, user, organization: target }) => {
            await bestEffort('invitation audit', async () => {
              await services.organizationAudit.invitation(
                await hookActor(user),
                target,
                invitation,
                'accepted'
              )
            })
          },
          afterRejectInvitation: async ({ invitation, user, organization: target }) => {
            await bestEffort('invitation audit', async () => {
              await services.organizationAudit.invitation(
                await hookActor(user),
                target,
                invitation,
                'rejected'
              )
            })
          },
          afterCancelInvitation: async ({ invitation, cancelledBy, organization: target }) => {
            await bestEffort('invitation audit', async () => {
              await services.organizationAudit.invitation(
                await hookActor(cancelledBy),
                target,
                invitation,
                'canceled'
              )
            })
          }
        }
      }),
      apiKey({
        defaultPrefix: 'ml_',
        enableMetadata: true,
        references: 'organization',
        rateLimit: { enabled: false }
      })
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            await assertDomainAllowed(user.email)

            const [row] = await db.select({ value: count() }).from(authSchema.user)
            const isFirst = (row?.value ?? 0) === 0
            const role = isFirst ? 'admin' : (instanceRole(user) ?? 'user')

            if (isFirst || ctx?.path === '/admin/create-user') return { data: { ...user, role } }

            const devPasswordSignUp = import.meta.dev && ctx?.path === '/sign-up/email'

            if (!user.emailVerified && !devPasswordSignUp)
              throw refuse(
                SIGN_IN_ERROR_CODES.emailNotVerified,
                'Your Google account email is not verified.'
              )

            if (!(await services.organizations.hasPendingInvitationFor(user.email)))
              throw refuse(
                SIGN_IN_ERROR_CODES.invitationRequired,
                'This instance is invitation only. Sign in with the invited Google account.'
              )

            return { data: { ...user, role, emailVerified: true } }
          },
          // The first account owns the "Default" organization.
          after: async (user) => {
            await bestEffort('first user setup', async () => {
              const organizationId = await services.organizations.adoptFirstUser(user.id)

              if (organizationId) await services.organizations.initialize(organizationId, 'Default')
            })
          }
        }
      },
      session: {
        create: {
          before: async (session) => {
            const [owner] = await db
              .select({ email: authSchema.user.email })
              .from(authSchema.user)
              .where(eq(authSchema.user.id, session.userId))

            if (owner) await assertDomainAllowed(owner.email)

            const [first] = await services.organizations.listForUser(session.userId)

            return { data: { ...session, activeOrganizationId: first?.id ?? null } }
          }
        }
      }
    }
  }
})
