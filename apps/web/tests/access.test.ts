import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { instanceSettings, invitation, session, user } from '../server/db/schema'
import { SYSTEM_ACTOR } from '../server/lib/core/actor'
import { ValidationError } from '../server/lib/core/errors'
import { TestPlatform } from './support/platform'

const platform = new TestPlatform()
const access = platform.container.access

afterAll(() => platform.dispose())

beforeEach(async () => {
  await platform.db.delete(instanceSettings)
})

async function signedInUser(email: string): Promise<string> {
  const [created] = await platform.db
    .insert(user)
    .values({ name: email, email, emailVerified: true })
    .returning({ id: user.id })

  if (!created) throw new Error('Could not create the user')
  await platform.db.insert(session).values({
    userId: created.id,
    token: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000),
    updatedAt: new Date()
  })

  return created.id
}

async function sessionsOf(userId: string): Promise<number> {
  const rows = await platform.db.select().from(session).where(eq(session.userId, userId))

  return rows.length
}

describe('allowed sign-in domains', () => {
  it('lets anyone in until domains are set, then only those domains', async () => {
    expect(await access.allows('someone@gmail.com')).toBe(true)

    await access.update(
      { allowedDomains: ['@MyCompany.com', 'mycompany.com'] },
      SYSTEM_ACTOR,
      'admin@mycompany.com'
    )

    expect(await access.settings()).toEqual({ allowedDomains: ['mycompany.com'] })
    expect(await access.allows('Ada@MYCOMPANY.com')).toBe(true)
    expect(await access.allows('ada@mycompany.com.evil.test')).toBe(false)
    expect(await access.allows('ada@sub.mycompany.com')).toBe(false)
    expect(await access.allows('someone@gmail.com')).toBe(false)
  })

  it('signs out users of other domains and keeps the allowed ones signed in', async () => {
    const insider = await signedInUser(`in-${randomUUID()}@acme.test`)
    const outsider = await signedInUser(`out-${randomUUID()}@gmail.com`)

    const result = await access.update(
      { allowedDomains: ['acme.test'] },
      SYSTEM_ACTOR,
      'admin@acme.test'
    )

    expect(result.revokedSessions).toBeGreaterThanOrEqual(1)
    expect(await sessionsOf(insider)).toBe(1)
    expect(await sessionsOf(outsider)).toBe(0)
  })

  it('refuses a list that would lock the administrator out', async () => {
    await expect(
      access.update({ allowedDomains: ['acme.test'] }, SYSTEM_ACTOR, 'admin@other.test')
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await access.settings()).toEqual({ allowedDomains: [] })
  })
})

describe('invitation-only sign-up', () => {
  it('accepts only emails with a pending, unexpired invitation', async () => {
    const org = await platform.organization('Invites')
    const inviterId = await signedInUser(`owner-${randomUUID()}@acme.test`)
    const invited = `new-${randomUUID()}@acme.test`
    const expired = `old-${randomUUID()}@acme.test`

    await platform.db.insert(invitation).values([
      {
        organizationId: org.id,
        email: invited,
        role: 'member',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
        inviterId
      },
      {
        organizationId: org.id,
        email: expired,
        role: 'member',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
        inviterId
      }
    ])

    const organizations = platform.container.organizations

    expect(await organizations.hasPendingInvitationFor(invited.toUpperCase())).toBe(true)
    expect(await organizations.hasPendingInvitationFor(expired)).toBe(false)
    expect(await organizations.hasPendingInvitationFor(`stranger-${randomUUID()}@acme.test`)).toBe(
      false
    )
  })
})
