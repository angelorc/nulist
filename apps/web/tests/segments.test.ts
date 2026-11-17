import { afterAll, describe, expect, it } from 'vitest'
import { schema } from '../server/db/client'
import { NotFoundError } from '../server/lib/core/errors'
import { broadcastCreateSchema } from '../shared/schemas/broadcasts'
import { segmentInputSchema, segmentRulesSchema } from '../shared/schemas/segments'
import type { SegmentActivityConditionState, SegmentRulesState } from '../shared/schemas/segments'
import { templateCreateSchema } from '../shared/schemas/templates'
import { topicInputSchema } from '../shared/schemas/topics'
import type { SegmentRules } from '../shared/types/domain'
import { TestPlatform } from './support/platform'
import type { TestOrganization } from './support/platform'

const platform = new TestPlatform()

afterAll(() => platform.dispose())

async function matching(org: TestOrganization, rules: SegmentRulesState): Promise<string[]> {
  const contacts = await org.services.segments.preview(segmentRulesSchema.parse(rules), 50)

  return contacts.map((contact) => contact.email).toSorted()
}

async function segment(org: TestOrganization, name: string, rules: SegmentRulesState) {
  return org.services.segments.create(segmentInputSchema.parse({ name, rules }), org.actor)
}

function activity(condition: Omit<SegmentActivityConditionState, 'field'>): SegmentRulesState {
  return { conditions: [{ field: 'activity', ...condition }] }
}

function topic(
  operator: 'subscribed_topic' | 'unsubscribed_topic',
  value: string
): SegmentRulesState {
  return { conditions: [{ field: 'topic', operator, value }] }
}

function included(id: string, times: number): SegmentRulesState {
  return {
    match: 'any',
    conditions: Array.from({ length: times }, () => ({
      field: 'segment',
      operator: 'in_segment',
      value: id
    }))
  }
}

async function broadcast(org: TestOrganization, name: string) {
  return org.services.broadcasts.create(broadcastCreateSchema.parse({ name }), org.actor)
}

describe('segment rules', () => {
  it('keeps evaluating flat rules stored before groups and activity', async () => {
    const org = await platform.organization('Stored rules')
    const ceo = await org.contact({ email: 'ceo@acme.test' })
    const opener = await org.contact({ email: 'opener@other.test' })
    await org.contact({ email: 'silent@other.test' })

    await org.emailActivity({
      contactId: opener.id,
      kind: 'transactional',
      events: [{ type: 'open', daysAgo: 3 }]
    })

    const stored: SegmentRules = {
      match: 'any',
      conditions: [
        { field: 'email', operator: 'ends_with', value: '@acme.test' },
        { field: 'engagement', operator: 'opened_within_days', value: 30 }
      ]
    }

    await platform.db
      .insert(schema.segments)
      .values({ organizationId: org.id, name: 'Stored', rules: stored })

    expect(segmentRulesSchema.parse(stored)).toEqual(stored)
    expect(await org.services.segments.list()).toMatchObject([{ name: 'Stored', contactCount: 2 }])
    expect(await org.services.segments.memberships(ceo.id)).toMatchObject([{ name: 'Stored' }])
  })

  it('combines all, any and none groups', async () => {
    const org = await platform.organization('Groups')
    const customers = await org.list('Customers')
    await org.contact({ email: 'pro@x.test', attributes: { plan: 'pro' } })
    await org.contact({ email: 'customer@x.test', listIds: [customers.id] })
    await org.contact({ email: 'free@x.test' })
    await org.contact({ email: 'zed@x.test', attributes: { plan: 'pro' } })
    await org.contact({ email: 'vip@x.test', attributes: { plan: 'pro', vip: 'yes' } })
    await org.contact({ email: 'pro@y.test', attributes: { plan: 'pro' } })

    expect(
      await matching(org, {
        match: 'all',
        conditions: [
          { field: 'email', operator: 'ends_with', value: '@x.test' },
          {
            match: 'any',
            conditions: [
              { field: 'attribute', key: 'plan', operator: 'eq', value: 'pro' },
              { field: 'list', operator: 'in_list', value: customers.id }
            ]
          },
          {
            match: 'none',
            conditions: [
              { field: 'email', operator: 'starts_with', value: 'zed' },
              { field: 'attribute', key: 'vip', operator: 'eq', value: 'yes' }
            ]
          }
        ]
      })
    ).toEqual(['customer@x.test', 'pro@x.test'])

    expect(
      await matching(org, {
        match: 'any',
        conditions: [
          {
            match: 'all',
            conditions: [
              { field: 'attribute', key: 'plan', operator: 'eq', value: 'pro' },
              { field: 'attribute', key: 'vip', operator: 'eq', value: 'yes' }
            ]
          },
          { field: 'email', operator: 'eq', value: 'free@x.test' }
        ]
      })
    ).toEqual(['free@x.test', 'vip@x.test'])
  })

  it('matches broadcast activity by broadcast, count and time window', async () => {
    const org = await platform.organization('Broadcast activity')
    const may = await broadcast(org, 'May launch')
    const june = await broadcast(org, 'June news')
    const loyal = await org.contact({ email: 'loyal@example.test' })
    const lapsed = await org.contact({ email: 'lapsed@example.test' })
    const newcomer = await org.contact({ email: 'newcomer@example.test' })
    await org.contact({ email: 'stranger@example.test' })

    await org.emailActivity({
      contactId: loyal.id,
      kind: 'broadcast',
      broadcastId: may.id,
      events: [
        { type: 'send', daysAgo: 10 },
        { type: 'open', daysAgo: 9 }
      ]
    })
    await org.emailActivity({
      contactId: lapsed.id,
      kind: 'broadcast',
      broadcastId: may.id,
      events: [
        { type: 'send', daysAgo: 100 },
        { type: 'open', daysAgo: 100 }
      ]
    })

    await Promise.all(
      [loyal, lapsed, newcomer].map((contact) =>
        org.emailActivity({
          contactId: contact.id,
          kind: 'broadcast',
          broadcastId: june.id,
          events: [{ type: 'send', daysAgo: 3 }]
        })
      )
    )

    expect(
      await matching(
        org,
        activity({ operator: 'has', event: 'opened', scope: 'broadcast', broadcastId: may.id })
      )
    ).toEqual(['lapsed@example.test', 'loyal@example.test'])

    expect(
      await matching(
        org,
        activity({ operator: 'has', event: 'sent', scope: 'broadcast', times: 2, days: 30 })
      )
    ).toEqual(['loyal@example.test'])

    expect(
      await matching(
        org,
        activity({ operator: 'has', event: 'sent', scope: 'broadcast', times: 2, days: null })
      )
    ).toEqual(['lapsed@example.test', 'loyal@example.test'])

    expect(
      await matching(
        org,
        activity({ operator: 'has_not', event: 'opened', scope: 'broadcast', days: 30 })
      )
    ).toEqual(['lapsed@example.test', 'newcomer@example.test', 'stranger@example.test'])
  })

  it('matches transactional and click activity, ignoring bots and system mail', async () => {
    const org = await platform.organization('Transactional activity')

    const receipt = await org.services.templates.create(
      templateCreateSchema.parse({
        name: 'Receipt',
        kind: 'transactional',
        slug: 'receipt',
        editor: 'code'
      }),
      org.actor
    )

    const buyer = await org.contact({ email: 'buyer@example.test' })
    const free = await org.contact({ email: 'free@example.test' })
    const nested = await org.contact({ email: 'nested@example.test' })
    const robot = await org.contact({ email: 'robot@example.test' })
    const admin = await org.contact({ email: 'admin@example.test' })

    await org.emailActivity({
      contactId: buyer.id,
      kind: 'transactional',
      templateId: receipt.id,
      tags: { plan: 'pro' },
      events: [
        { type: 'delivery' },
        { type: 'open', data: { isBotEvent: false } },
        { type: 'click', data: { link: 'https://shop.test/pricing?ref=mail' } }
      ]
    })
    await org.emailActivity({
      contactId: free.id,
      kind: 'transactional',
      templateId: receipt.id,
      tags: { plan: 'free' },
      events: [{ type: 'delivery' }, { type: 'open' }]
    })
    await org.emailActivity({
      contactId: nested.id,
      kind: 'transactional',
      events: [{ type: 'click', data: { click: { link: 'https://shop.test/PRICING' } } }]
    })
    await org.emailActivity({
      contactId: robot.id,
      kind: 'broadcast',
      events: [
        { type: 'open', data: { isBotEvent: true } },
        { type: 'click', data: { link: 'https://shop.test/pricing', isBotEvent: true } }
      ]
    })
    await org.emailActivity({
      contactId: admin.id,
      kind: 'system',
      events: [{ type: 'open' }, { type: 'click', data: { link: 'https://shop.test/pricing' } }]
    })

    const transactional: SegmentActivityConditionState = {
      field: 'activity',
      operator: 'has',
      event: 'delivered',
      scope: 'transactional',
      templateId: receipt.id
    }

    expect(await matching(org, { conditions: [transactional] })).toEqual([
      'buyer@example.test',
      'free@example.test'
    ])

    expect(
      await matching(org, {
        conditions: [{ ...transactional, tag: { key: 'plan', value: 'pro' } }]
      })
    ).toEqual(['buyer@example.test'])

    expect(
      await matching(org, {
        conditions: [{ field: 'activity', operator: 'has', event: 'opened', scope: 'any' }]
      })
    ).toEqual(['buyer@example.test', 'free@example.test'])

    expect(
      await matching(org, {
        conditions: [
          { field: 'activity', operator: 'has', event: 'clicked', scope: 'any', link: 'pricing' }
        ]
      })
    ).toEqual(['buyer@example.test', 'nested@example.test'])
  })

  it('selects contacts by topic subscription, following the topic default', async () => {
    const org = await platform.organization('Topics')
    const { topics } = org.services

    const promotions = await topics.create(
      topicInputSchema.parse({ name: 'Promotions' }),
      org.actor
    )

    const product = await topics.create(
      topicInputSchema.parse({ name: 'Product news', defaultSubscribed: false }),
      org.actor
    )

    const out = await org.contact({ email: 'out@example.test' })
    const keen = await org.contact({ email: 'keen@example.test' })
    await org.contact({ email: 'quiet@example.test' })
    await topics.setPreference(out.id, promotions.id, false)
    await topics.setPreference(keen.id, product.id, true)

    expect(await matching(org, topic('subscribed_topic', promotions.id))).toEqual([
      'keen@example.test',
      'quiet@example.test'
    ])
    expect(await matching(org, topic('unsubscribed_topic', promotions.id))).toEqual([
      'out@example.test'
    ])
    expect(await matching(org, topic('subscribed_topic', product.id))).toEqual([
      'keen@example.test'
    ])
  })
})

describe('segment references', () => {
  it('nests segments, rejects loops and keeps referenced segments', async () => {
    const org = await platform.organization('Nested segments')
    await org.contact({ email: 'a@example.test' })
    await org.contact({ email: 'b@example.test' })
    await org.contact({ email: 'c@example.test' })
    const { segments } = org.services

    const pair = await segment(org, 'A or B', {
      match: 'any',
      conditions: [
        { field: 'email', operator: 'eq', value: 'a@example.test' },
        { field: 'email', operator: 'eq', value: 'b@example.test' }
      ]
    })

    const within = await segment(org, 'Within A or B', {
      conditions: [{ field: 'segment', operator: 'in_segment', value: pair.id }]
    })

    expect(
      await matching(org, {
        conditions: [{ field: 'segment', operator: 'not_in_segment', value: within.id }]
      })
    ).toEqual(['c@example.test'])

    await expect(
      segments.update(
        pair.id,
        {
          rules: segmentRulesSchema.parse({
            conditions: [{ field: 'segment', operator: 'in_segment', value: within.id }]
          })
        },
        org.actor
      )
    ).rejects.toMatchObject({
      message: 'A segment cannot include itself, directly or through another segment',
      data: { issues: [{ path: ['conditions', '0', 'value'] }] }
    })

    await expect(
      segments.update(
        pair.id,
        {
          rules: segmentRulesSchema.parse({
            conditions: [
              {
                match: 'any',
                conditions: [{ field: 'segment', operator: 'in_segment', value: pair.id }]
              }
            ]
          })
        },
        org.actor
      )
    ).rejects.toMatchObject({
      data: { issues: [{ path: ['conditions', '0', 'conditions', '0', 'value'] }] }
    })

    await expect(segments.delete(pair.id, org.actor)).rejects.toMatchObject({
      code: 'segment_in_use',
      message: 'Segment is used by the segment "Within A or B". Remove it there first.'
    })

    await segments.delete(within.id, org.actor)

    await expect(segments.delete(pair.id, org.actor)).resolves.toBeUndefined()
  })

  it('rejects nesting that could never be evaluated, also through included segments', async () => {
    const org = await platform.organization('Nesting limits')
    const { segments } = org.services

    const wide = await segment(org, 'Wide', {
      conditions: Array.from({ length: 50 }, (_, i) => ({
        field: 'email',
        operator: 'eq',
        value: `c${i}@example.test`
      }))
    })

    await expect(segment(org, 'Wider', included(wide.id, 4))).rejects.toMatchObject({
      message:
        'Segments can use at most 200 conditions, counting the conditions of the segments they include'
    })

    const base = await segment(org, 'Level 1', {
      conditions: [{ field: 'email', operator: 'eq', value: 'a@example.test' }]
    })

    let top = base

    for (const level of [2, 3, 4, 5, 6]) {
      top = await segment(org, `Level ${level}`, included(top.id, 1))
    }

    const extra = await segment(org, 'Extra', {
      conditions: [{ field: 'email', operator: 'eq', value: 'b@example.test' }]
    })

    await expect(
      segments.update(
        base.id,
        { rules: segmentRulesSchema.parse(included(extra.id, 1)) },
        org.actor
      )
    ).rejects.toMatchObject({
      message:
        'The segment "Level 6" includes this segment and would stop working: Segments are nested too deeply'
    })

    expect(await segments.get(top.id)).toMatchObject({ contactCount: 0 })
  })

  it('lists the segments a contact currently matches', async () => {
    const org = await platform.organization('Memberships')
    const other = await platform.organization('Memberships elsewhere')
    const ceo = await org.contact({ email: 'ceo@acme.test', attributes: { plan: 'pro' } })
    const intern = await org.contact({ email: 'intern@acme.test' })
    const stranger = await org.contact({ email: 'stranger@other.test' })

    const acme = await segment(org, 'Acme', {
      conditions: [{ field: 'email', operator: 'ends_with', value: '@acme.test' }]
    })

    const pro = await segment(org, 'Pro', {
      conditions: [{ field: 'attribute', key: 'plan', operator: 'eq', value: 'pro' }]
    })

    const acmePros = await segment(org, 'Acme pros', {
      conditions: [
        { field: 'segment', operator: 'in_segment', value: acme.id },
        { field: 'segment', operator: 'in_segment', value: pro.id }
      ]
    })

    const { segments } = org.services

    expect(await segments.memberships(ceo.id)).toEqual([
      { id: acme.id, name: 'Acme' },
      { id: acmePros.id, name: 'Acme pros' },
      { id: pro.id, name: 'Pro' }
    ])
    expect(await segments.memberships(intern.id)).toEqual([{ id: acme.id, name: 'Acme' }])
    expect(await segments.memberships(stranger.id)).toEqual([])
    await expect(other.services.segments.memberships(ceo.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('leaves contacts of excluded segments out of the estimate and the send', async () => {
    const org = await platform.organization('Excluded segments')
    const news = await org.list('News')
    await org.contact({ email: 'alice@example.test', listIds: [news.id] })
    await org.contact({ email: 'bob@example.test', listIds: [news.id] })
    await org.contact({
      email: 'carol@example.test',
      listIds: [news.id],
      attributes: { plan: 'pro' }
    })
    await org.contact({ email: 'dave@example.test', attributes: { plan: 'pro' } })

    const pro = await segment(org, 'Pro plan', {
      conditions: [{ field: 'attribute', key: 'plan', operator: 'eq', value: 'pro' }]
    })

    const audience = {
      listIds: [news.id],
      segmentIds: [],
      excludeListIds: [],
      excludeSegmentIds: [pro.id]
    }

    expect(await org.services.broadcasts.estimate(audience)).toBe(2)

    const broadcastId = await org.sendBroadcast({ audience })

    expect(await org.recipientsOf(broadcastId)).toEqual(['alice@example.test', 'bob@example.test'])
  })
})
