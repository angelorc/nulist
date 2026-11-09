import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { publicActor } from '../server/lib/core/actor'
import { preferencesUpdateSchema } from '../shared/schemas/public'
import { topicInputSchema } from '../shared/schemas/topics'
import type { SubscriptionStatus } from '../shared/types/domain'
import { TestPlatform, linkIn, tokenOf } from './support/platform'
import type { TestOrganization } from './support/platform'

const platform = new TestPlatform()

afterAll(() => platform.dispose())

/** The contact's subscription status on a list (null: not a member). */
async function membership(
  org: TestOrganization,
  email: string,
  listId: string
): Promise<SubscriptionStatus | null> {
  const contact = await org.services.contacts.findByEmail(email)

  if (!contact) throw new Error(`No contact ${email}`)
  const detail = await org.services.contacts.get(contact.id)

  return detail.subscriptions.find((subscription) => subscription.listId === listId)?.status ?? null
}

/** Contacts whose double opt-in workflow was started in the organization, for one list. */
function optInsStarted(org: TestOrganization, listId: string): string[] {
  return platform
    .launched('doubleOptIn')
    .filter(({ args }) => args[0] === org.id && args[2] === listId)
    .map(({ args }) => z.string().parse(args[1]))
}

describe('CSV import', () => {
  it('maps columns, normalises and de-duplicates rows, and never re-subscribes opted-out addresses', async () => {
    const org = await platform.organization('Import')
    const { contacts, suppressions } = org.services
    const list = await org.list('Newsletter', 'double')

    const existing = await org.contact({
      email: 'existing@example.test',
      firstName: 'Old',
      attributes: { plan: 'free', city: 'Rome' }
    })

    const left = await org.contact({
      email: 'left@example.test',
      listIds: [list.id],
      skipOptIn: true
    })

    await contacts.unsubscribe(left.id, list.id, org.actor, 'preferences')
    const gone = await org.contact({ email: 'gone@example.test' })
    await contacts.unsubscribe(gone.id, null, org.actor, 'preferences')
    await suppressions.add('bounced@example.test', 'hard_bounce', 'SES hard bounce')

    const csv = [
      'E-mail,First Name,Plan,Notes',
      ' Alice@Example.TEST ,Alice,pro,met at a fair',
      'bob@example.test,Bob,free,',
      'alice@example.test,Alicia,team,',
      'not-an-email,Zed,free,',
      ',Nobody,free,',
      'existing@example.test,Ex,pro,',
      'bounced@example.test,Bo,free,',
      'left@example.test,Le,free,',
      'gone@example.test,Go,free,'
    ].join('\n')

    const result = await org.importCsv({
      fileName: 'people.csv',
      csv,
      mapping: {
        'E-mail': 'email',
        'First Name': 'first_name',
        Plan: 'attribute:plan',
        Notes: 'ignore'
      },
      listId: list.id,
      subscriptionStatus: 'send_opt_in'
    })

    expect(result).toMatchObject({
      status: 'completed',
      totalRows: 9,
      processedRows: 9,
      createdCount: 3,
      updatedCount: 3,
      skippedCount: 1,
      errorCount: 2
    })
    expect(result.errors).toEqual([
      { row: 5, email: 'not-an-email', message: 'Invalid email address' },
      { row: 6, message: 'Missing email address' }
    ])

    // First occurrence wins, the address is normalised and ignored columns are dropped.
    expect(await contacts.findByEmail('alice@example.test')).toMatchObject({
      firstName: 'Alice',
      attributes: { plan: 'pro' },
      status: 'active',
      source: 'import'
    })
    // Merge mode updates names and merges attributes.
    expect(await contacts.findOrFail(existing.id)).toMatchObject({
      firstName: 'Ex',
      attributes: { plan: 'pro', city: 'Rome' }
    })
    expect((await contacts.findByEmail('bounced@example.test'))?.status).toBe('bounced')
    expect((await contacts.findOrFail(gone.id)).status).toBe('unsubscribed')

    const statuses = await Promise.all(
      ['alice', 'bob', 'existing', 'left', 'bounced', 'gone'].map((name) =>
        membership(org, `${name}@example.test`, list.id)
      )
    )

    expect(statuses).toEqual([
      'unconfirmed',
      'unconfirmed',
      'unconfirmed',
      'unsubscribed',
      null,
      null
    ])
    expect(optInsStarted(org, list.id)).toHaveLength(3)
  })
})

describe('double opt-in', () => {
  it('confirms the subscription from the link in the confirmation email', async () => {
    const org = await platform.organization('Double opt-in')
    const list = await org.list('Weekly', 'double')
    const contact = await org.contact({ email: 'new@example.test', listIds: [list.id] })

    expect(optInsStarted(org, list.id)).toEqual([contact.id])
    expect(await membership(org, 'new@example.test', list.id)).toBe('unconfirmed')
    expect((await org.services.optIn.sendConfirmation(contact.id, list.id)).status).toBe('sent')

    const token = tokenOf(linkIn(platform.mail.only('new@example.test').html, '/confirm/'))
    const { services } = await platform.container.publicContext.fromToken('optin', token)
    const actor = publicActor('Confirmation page', '203.0.113.7')

    expect(await services.optIn.confirm(token, actor)).toMatchObject({ alreadyConfirmed: false })
    expect(await membership(org, 'new@example.test', list.id)).toBe('confirmed')
    expect((await org.services.contacts.findOrFail(contact.id)).consentIp).toBe('203.0.113.7')
    expect(platform.jobs.launched).toContainEqual({
      job: 'resumeHook',
      args: [`optin:${contact.id}:${list.id}`, { confirmed: true }]
    })
    expect(await services.optIn.confirm(token, actor)).toMatchObject({ alreadyConfirmed: true })
  })

  it('rejects tampered, foreign, wrong-purpose and expired confirmation links', async () => {
    const org = await platform.organization('Opt-in links')
    const other = await platform.organization('Other tenant')
    const list = await org.list('Weekly', 'double')
    const contact = await org.contact({ email: 'pending@example.test', listIds: [list.id] })
    const claims = { c: contact.id, l: list.id }
    const { optIn } = org.services
    const actor = publicActor()
    const valid = tokenOf(await org.services.links.confirmUrl(claims, 7))
    const tampered = `${valid.slice(0, -2)}${valid.endsWith('AA') ? 'BB' : 'AA'}`
    const foreign = tokenOf(await other.services.links.confirmUrl(claims, 7))
    const preferences = tokenOf(await org.services.links.preferencesUrl(claims))

    await Promise.all(
      [tampered, foreign, preferences].map((token) =>
        expect(optIn.confirm(token, actor)).rejects.toMatchObject({
          status: 400,
          code: 'invalid_token'
        })
      )
    )

    const expired = await platform.container.tokens.sign('optin', { ...claims, o: org.id }, '-1h')

    await expect(optIn.confirm(expired, actor)).rejects.toMatchObject({
      status: 410,
      code: 'token_expired'
    })

    // The pending subscription ran out: a still-valid link can no longer confirm it.
    expect(await optIn.expire(contact.id, list.id)).toEqual({ expired: true })
    await expect(optIn.confirm(valid, actor)).rejects.toMatchObject({
      status: 410,
      code: 'optin_expired'
    })
    expect(await membership(org, 'pending@example.test', list.id)).toBeNull()
  })
})

describe('preferences and unsubscribes', () => {
  it('applies list and topic choices from the preference center', async () => {
    const org = await platform.organization('Preferences')
    const weekly = await org.list('Weekly')
    const offers = await org.list('Offers')
    const events = await org.list('Events', 'double')
    const { topics, preferences, links } = org.services
    const news = await topics.create(topicInputSchema.parse({ name: 'Product news' }), org.actor)

    const contact = await org.contact({
      email: 'reader@example.test',
      listIds: [weekly.id, offers.id]
    })

    const token = tokenOf(await links.preferencesUrl({ c: contact.id }))

    const update = preferencesUpdateSchema.parse({
      lists: { [offers.id]: false, [events.id]: true },
      topics: { [news.id]: false }
    })

    const snapshot = await preferences.updatePreferences(token, update)

    expect(snapshot.status).toBe('active')
    expect(snapshot.topics).toEqual([expect.objectContaining({ id: news.id, subscribed: false })])
    expect(await membership(org, 'reader@example.test', weekly.id)).toBe('confirmed')
    expect(await membership(org, 'reader@example.test', offers.id)).toBe('unsubscribed')
    // Joining a double opt-in list from the preference center still needs a confirmation.
    expect(await membership(org, 'reader@example.test', events.id)).toBe('unconfirmed')
    expect(optInsStarted(org, events.id)).toEqual([contact.id])
    expect(await topics.isSubscribed(contact.id, news.id)).toBe(false)
  })

  it('one-click unsubscribes from the lists a broadcast was sent to (RFC 8058)', async () => {
    const org = await platform.organization('One-click lists')
    const weekly = await org.list('Weekly')
    const offers = await org.list('Offers')
    await org.contact({ email: 'subscriber@example.test', listIds: [weekly.id, offers.id] })

    await org.sendBroadcast({ audience: { listIds: [weekly.id] } })

    const { headers } = platform.mail.only('subscriber@example.test')

    expect(headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    const token = tokenOf(headers?.['List-Unsubscribe']?.replace(/^<|>$/g, '') ?? '')
    const { services } = await platform.container.publicContext.fromToken('unsubscribe', token)

    expect(await services.preferences.oneClickUnsubscribe(token)).toEqual({
      changed: true,
      scope: 'lists',
      listIds: [weekly.id]
    })
    expect(await membership(org, 'subscriber@example.test', weekly.id)).toBe('unsubscribed')
    expect(await membership(org, 'subscriber@example.test', offers.id)).toBe('confirmed')
    expect((await services.contacts.findByEmail('subscriber@example.test'))?.status).toBe('active')
    // Mail clients may retry the POST: the second request changes nothing.
    expect((await services.preferences.oneClickUnsubscribe(token)).changed).toBe(false)
  })

  it('one-click without a list unsubscribes from everything and suppresses the address', async () => {
    const org = await platform.organization('One-click global')
    const weekly = await org.list('Weekly')
    const { preferences, links, contacts, suppressions } = org.services
    const contact = await org.contact({ email: 'reader@example.test', listIds: [weekly.id] })
    const token = tokenOf(await links.unsubscribeUrl({ c: contact.id }))

    expect(await preferences.oneClickUnsubscribe(token)).toEqual({
      changed: true,
      scope: 'global',
      listIds: []
    })
    expect((await contacts.findOrFail(contact.id)).status).toBe('unsubscribed')
    expect((await suppressions.find('reader@example.test'))?.reason).toBe('unsubscribe')
    expect(await membership(org, 'reader@example.test', weekly.id)).toBe('unsubscribed')
    expect((await preferences.oneClickUnsubscribe(token)).changed).toBe(false)
  })
})
