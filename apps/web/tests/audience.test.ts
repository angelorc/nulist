import { afterAll, describe, expect, it } from 'vitest'
import { emailEvents } from '../server/db/schema'
import { segmentInputSchema, segmentRulesSchema } from '../shared/schemas/segments'
import type { SegmentConditionState } from '../shared/schemas/segments'
import { topicInputSchema } from '../shared/schemas/topics'
import type { MessageKind } from '../shared/types/domain'
import { TestPlatform } from './support/platform'
import type { TestOrganization } from './support/platform'

const DAY_MS = 86_400_000

const platform = new TestPlatform()

afterAll(() => platform.dispose())

/** Emails of the organization's contacts matching the rules, sorted. */
async function matching(
  org: TestOrganization,
  match: 'all' | 'any',
  conditions: SegmentConditionState[]
): Promise<string[]> {
  const rules = segmentRulesSchema.parse({ match, conditions })
  const contacts = await org.services.segments.preview(rules, 50)

  return contacts.map((contact) => contact.email).toSorted()
}

describe('sending eligibility', () => {
  it('sends a broadcast once per eligible contact across lists and segments', async () => {
    const org = await platform.organization('Eligibility')
    const news = await org.list('News')
    const offers = await org.list('Offers')
    const members = await org.list('Members', 'double')
    const excluded = await org.list('Already customers')
    const { contacts, suppressions, suppressionAdmin, topics } = org.services

    const promotions = await topics.create(
      topicInputSchema.parse({ name: 'Promotions' }),
      org.actor
    )

    const proPlan = await org.services.segments.create(
      segmentInputSchema.parse({
        name: 'Pro plan',
        rules: { conditions: [{ field: 'attribute', key: 'plan', operator: 'eq', value: 'pro' }] }
      }),
      org.actor
    )

    // Eligible: on two lists and in the segment, on one list, in the segment only.
    await org.contact({
      email: 'alice@example.test',
      listIds: [news.id, offers.id],
      attributes: { plan: 'pro' }
    })
    await org.contact({ email: 'bob@example.test', listIds: [news.id] })
    await org.contact({ email: 'jack@example.test', attributes: { plan: 'pro' } })

    // Not eligible, each for one reason.
    const carol = await org.contact({ email: 'carol@example.test', listIds: [news.id] })
    await contacts.unsubscribe(carol.id, null, org.actor, 'preferences')
    await org.contact({ email: 'dave@example.test', listIds: [news.id] })
    await suppressionAdmin.add('dave@example.test', org.actor)
    await org.contact({ email: 'erin@example.test', listIds: [news.id] })
    await suppressions.add('erin@example.test', 'hard_bounce', 'SES hard bounce')
    await org.contact({ email: 'frank@example.test', listIds: [news.id] })
    await suppressions.add('frank@example.test', 'complaint', 'SES complaint')
    await org.contact({ email: 'gina@example.test', listIds: [members.id] })
    const hank = await org.contact({ email: 'hank@example.test', listIds: [news.id] })
    await topics.setPreference(hank.id, promotions.id, false)
    await org.contact({ email: 'ivy@example.test', listIds: [news.id, excluded.id] })

    const audience = {
      listIds: [news.id, offers.id, members.id],
      segmentIds: [proPlan.id],
      excludeListIds: [excluded.id]
    }

    const eligible = ['alice@example.test', 'bob@example.test', 'jack@example.test']

    expect(await org.services.broadcasts.estimate(audience, promotions.id)).toBe(eligible.length)

    const broadcastId = await org.sendBroadcast({ audience, topicId: promotions.id })

    expect(await org.recipientsOf(broadcastId)).toEqual(eligible)

    for (const email of eligible) expect(platform.mail.only(email).subject).toBe('News')
  })

  it('lets transactional and system mail reach unsubscribed contacts, never bounces or complaints', async () => {
    const org = await platform.organization('Transactional reach')
    const { contacts, suppressions } = org.services
    const unsubscribed = await org.contact({ email: 'left@example.test' })
    await contacts.unsubscribe(unsubscribed.id, null, org.actor, 'one_click')
    await suppressions.add('bounced@example.test', 'hard_bounce', 'SES hard bounce')
    await suppressions.add('complained@example.test', 'complaint', 'SES complaint')

    expect((await org.deliverEmail('left@example.test')).status).toBe('sent')
    expect((await org.deliverEmail('bounced@example.test')).status).toBe('suppressed')
    expect((await org.deliverEmail('complained@example.test')).status).toBe('suppressed')
    expect(platform.mail.to('bounced@example.test')).toHaveLength(0)
    expect(platform.mail.to('complained@example.test')).toHaveLength(0)

    const kinds: MessageKind[] = ['system', 'transactional', 'broadcast']

    const blocking = await Promise.all(
      kinds.map((kind) => suppressions.blockingReason('left@example.test', kind))
    )

    expect(blocking).toEqual([null, null, 'unsubscribe'])
  })
})

describe('segments', () => {
  it('combines attribute conditions with AND, comparing numbers numerically', async () => {
    const org = await platform.organization('Attributes')
    await org.contact({ email: 'big@example.test', attributes: { plan: 'pro', seats: 25 } })
    await org.contact({ email: 'small@example.test', attributes: { plan: 'pro', seats: 5 } })
    await org.contact({ email: 'team@example.test', attributes: { plan: 'team', seats: 50 } })
    await org.contact({ email: 'odd@example.test', attributes: { plan: 'pro', seats: 'many' } })
    await org.contact({ email: 'none@example.test' })

    expect(
      await matching(org, 'all', [
        { field: 'attribute', key: 'plan', operator: 'eq', value: 'pro' },
        { field: 'attribute', key: 'seats', operator: 'gt', value: 10 }
      ])
    ).toEqual(['big@example.test'])

    expect(
      await matching(org, 'all', [{ field: 'attribute', key: 'seats', operator: 'is_not_set' }])
    ).toEqual(['none@example.test'])
  })

  it('combines conditions with OR and counts only confirmed list members', async () => {
    const org = await platform.organization('Any of')
    const members = await org.list('Members', 'double')
    await org.contact({ email: 'ceo@acme.test' })
    await org.contact({ email: 'confirmed@other.test', listIds: [members.id], skipOptIn: true })
    await org.contact({ email: 'pending@other.test', listIds: [members.id] })
    await org.contact({ email: 'stranger@other.test' })

    expect(
      await matching(org, 'any', [
        { field: 'email', operator: 'ends_with', value: '@acme.test' },
        { field: 'list', operator: 'in_list', value: members.id }
      ])
    ).toEqual(['ceo@acme.test', 'confirmed@other.test'])
  })

  it('selects recent openers outside a list from the engagement history', async () => {
    const org = await platform.organization('Engagement')
    const customers = await org.list('Customers')
    const recent = await org.contact({ email: 'recent@example.test' })
    const stale = await org.contact({ email: 'stale@example.test' })
    const customer = await org.contact({ email: 'customer@example.test', listIds: [customers.id] })
    await org.contact({ email: 'silent@example.test' })

    const opened = (contactId: string, daysAgo: number) => ({
      organizationId: org.id,
      contactId,
      type: 'open' as const,
      occurredAt: new Date(Date.now() - daysAgo * DAY_MS)
    })

    await platform.db
      .insert(emailEvents)
      .values([opened(recent.id, 5), opened(stale.id, 60), opened(customer.id, 2)])

    expect(
      await matching(org, 'all', [
        { field: 'engagement', operator: 'opened_within_days', value: 30 },
        { field: 'list', operator: 'not_in_list', value: customers.id }
      ])
    ).toEqual(['recent@example.test'])

    expect(
      await matching(org, 'all', [
        { field: 'engagement', operator: 'not_opened_within_days', value: 30 }
      ])
    ).toEqual(['silent@example.test', 'stale@example.test'])
  })
})
