import { and, asc, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { schema } from '../server/db/client'
import { NotFoundError } from '../server/lib/core/errors'
import { segmentInputSchema, segmentRulesSchema } from '../shared/schemas/segments'
import type { SegmentRulesState } from '../shared/schemas/segments'
import { TestPlatform } from './support/platform'
import type { TestOrganization } from './support/platform'

const platform = new TestPlatform()

afterAll(() => platform.dispose())

function plan(value: string): SegmentRulesState {
  return { conditions: [{ field: 'attribute', key: 'plan', operator: 'eq', value }] }
}

async function segment(org: TestOrganization, name: string, rules: SegmentRulesState) {
  return org.services.segments.create(segmentInputSchema.parse({ name, rules }), org.actor)
}

async function changeRules(org: TestOrganization, id: string, rules: SegmentRulesState) {
  return org.services.segments.update(id, { rules: segmentRulesSchema.parse(rules) }, org.actor)
}

async function endpoint(
  org: TestOrganization,
  events: ('segment.entered' | 'segment.exited' | 'contact.created')[]
) {
  return org.services.webhookService.createEndpoint({ url: 'http://127.0.0.1/hooks', events })
}

async function segmentDeliveries(endpointId: string) {
  return platform.db
    .select({
      id: schema.webhookDeliveries.id,
      eventType: schema.webhookDeliveries.eventType,
      payload: schema.webhookDeliveries.payload
    })
    .from(schema.webhookDeliveries)
    .where(
      and(
        eq(schema.webhookDeliveries.endpointId, endpointId),
        inArray(schema.webhookDeliveries.eventType, ['segment.entered', 'segment.exited'])
      )
    )
    .orderBy(asc(schema.webhookDeliveries.eventType))
}

describe('segment membership history', () => {
  it('records a silent baseline, then entries, exits and re-entries with webhooks', async () => {
    const org = await platform.organization('Membership history')
    const { segmentMemberships, segments } = org.services
    const subscribed = await endpoint(org, ['segment.entered', 'segment.exited'])
    const unsubscribed = await endpoint(org, ['contact.created'])

    const ann = await org.contact({
      email: 'ann@example.test',
      firstName: 'Ann',
      lastName: 'Lee',
      attributes: { plan: 'pro' }
    })

    const bob = await org.contact({ email: 'bob@example.test', attributes: { plan: 'free' } })
    const pro = await segment(org, 'Plan', plan('pro'))
    const everyone = await segment(org, 'Everyone', { conditions: [] })

    expect(await segmentMemberships.memberSince(ann.id, [{ id: pro.id, name: 'Plan' }])).toEqual([
      { id: pro.id, name: 'Plan', memberSince: null }
    ])

    expect(await segmentMemberships.sync(pro.id)).toEqual({
      segmentId: pro.id,
      entered: 1,
      exited: 0,
      members: 1,
      baseline: true
    })
    expect(await segmentDeliveries(subscribed.id)).toEqual([])

    await changeRules(org, pro.id, plan('free'))

    expect(await segmentMemberships.sync(pro.id)).toEqual({
      segmentId: pro.id,
      entered: 1,
      exited: 1,
      members: 1,
      baseline: false
    })

    const deliveries = await segmentDeliveries(subscribed.id)

    expect(deliveries).toMatchObject([
      {
        eventType: 'segment.entered',
        payload: {
          type: 'segment.entered',
          data: {
            segment: { id: pro.id, name: 'Plan' },
            contact: { id: bob.id, email: 'bob@example.test', firstName: null, lastName: null },
            enteredAt: expect.any(String)
          }
        }
      },
      {
        eventType: 'segment.exited',
        payload: {
          type: 'segment.exited',
          data: {
            segment: { id: pro.id, name: 'Plan' },
            contact: { id: ann.id, email: 'ann@example.test', firstName: 'Ann', lastName: 'Lee' },
            exitedAt: expect.any(String)
          }
        }
      }
    ])
    expect(
      platform
        .launched('drainWebhookEndpoint')
        .flatMap(({ args }) => (args[0] === org.id ? [args[1]] : []))
    ).toEqual(expect.arrayContaining([subscribed.id]))
    expect(await segmentDeliveries(unsubscribed.id)).toEqual([])

    await changeRules(org, pro.id, {
      conditions: [{ field: 'attribute', key: 'plan', operator: 'is_set' }]
    })

    expect(await segmentMemberships.sync(pro.id)).toMatchObject({
      entered: 1,
      exited: 0,
      members: 2
    })

    const rows = await platform.db
      .select({ exitedAt: schema.segmentMemberships.exitedAt })
      .from(schema.segmentMemberships)
      .where(eq(schema.segmentMemberships.contactId, ann.id))
      .orderBy(asc(schema.segmentMemberships.id))

    expect(rows).toEqual([{ exitedAt: expect.any(Date) }, { exitedAt: null }])

    expect(await segmentMemberships.stats(pro.id)).toEqual({
      members: 2,
      enteredRecently: 2,
      exitedRecently: 1,
      syncedAt: expect.any(Date)
    })

    const history = await segmentMemberships.history(pro.id, { page: 1, pageSize: 3 })

    expect(history).toMatchObject({ total: 3, page: 1, pageSize: 3 })
    expect(history.items.map((item) => [item.change, item.contact?.email])).toEqual([
      ['entered', 'ann@example.test'],
      ['entered', 'bob@example.test'],
      ['exited', 'ann@example.test']
    ])

    const [reentry] = history.items

    expect(
      await segmentMemberships.memberSince(ann.id, await segments.memberships(ann.id))
    ).toEqual([
      { id: everyone.id, name: 'Everyone', memberSince: null },
      { id: pro.id, name: 'Plan', memberSince: reentry?.at }
    ])
  })

  it('wakes the endpoint of deliveries a failed launch left stranded', async () => {
    const org = await platform.organization('Queued deliveries')
    const subscribed = await endpoint(org, ['segment.entered'])
    const pro = await segment(org, 'Pro', plan('pro'))

    await org.services.segmentMemberships.sync(pro.id)
    await org.contact({ email: 'queued@example.test', attributes: { plan: 'pro' } })
    await org.services.segmentMemberships.sync(pro.id)

    const [delivery] = await segmentDeliveries(subscribed.id)

    if (!delivery) throw new Error('No segment.entered delivery was queued')

    await platform.db
      .update(schema.webhookEndpoints)
      .set({ drainLeaseUntil: null })
      .where(eq(schema.webhookEndpoints.id, subscribed.id))

    const before = platform.launched('drainWebhookEndpoint').length

    expect(await org.services.segmentMemberships.sync(pro.id)).toMatchObject({
      entered: 0,
      exited: 0
    })
    expect(platform.launched('drainWebhookEndpoint').slice(before)).toEqual([
      { job: 'drainWebhookEndpoint', args: [org.id, subscribed.id, expect.any(String)] }
    ])
  })

  it('closes the memberships of a deleted contact with an exit and an anonymous history row', async () => {
    const org = await platform.organization('Deleted members')
    const { contacts, segmentMemberships } = org.services
    const subscribed = await endpoint(org, ['segment.exited'])
    const pro = await segment(org, 'Pro', plan('pro'))

    const cara = await org.contact({
      email: 'cara@example.test',
      firstName: 'Cara',
      attributes: { plan: 'pro' }
    })

    await org.contact({ email: 'dan@example.test', attributes: { plan: 'pro' } })
    await segmentMemberships.sync(pro.id)
    await contacts.delete(cara.id, org.actor)

    expect(await segmentDeliveries(subscribed.id)).toMatchObject([
      {
        eventType: 'segment.exited',
        payload: {
          data: {
            segment: { id: pro.id, name: 'Pro' },
            contact: { id: cara.id, email: 'cara@example.test', firstName: 'Cara', lastName: null },
            exitedAt: expect.any(String)
          }
        }
      }
    ])

    const history = await segmentMemberships.history(pro.id, { page: 1, pageSize: 10 })

    expect(history.items).toMatchObject([{ change: 'exited', contact: null }])
    expect(await segmentMemberships.sync(pro.id)).toMatchObject({
      entered: 0,
      exited: 0,
      members: 1
    })
    expect(await segmentMemberships.stats(pro.id)).toMatchObject({ members: 1, exitedRecently: 1 })
  })

  it('syncs the segments that include a changed segment right away', async () => {
    const org = await platform.organization('Nested sync')
    const { segmentMemberships } = org.services
    const pro = await segment(org, 'Pro', plan('pro'))

    const includesPro = await segment(org, 'Includes pro', {
      conditions: [{ field: 'segment', operator: 'in_segment', value: pro.id }]
    })

    const eve = await org.contact({ email: 'eve@example.test', attributes: { plan: 'team' } })
    await segmentMemberships.syncAll()
    await changeRules(org, pro.id, plan('team'))

    expect(await segmentMemberships.syncWithDependents(pro.id)).toMatchObject([
      { segmentId: pro.id, entered: 1, exited: 0 },
      { segmentId: includesPro.id, entered: 1, exited: 0 }
    ])

    const history = await segmentMemberships.history(includesPro.id, { page: 1, pageSize: 10 })

    expect(history.items).toMatchObject([{ change: 'entered', contact: { id: eve.id } }])
  })

  it('requests a sync when a segment is created or its rules change', async () => {
    const org = await platform.organization('Sync requests')
    const { segments } = org.services
    const created = await segment(org, 'Pro', plan('pro'))

    await segments.update(created.id, { name: 'Pro plan' }, org.actor)
    await changeRules(org, created.id, plan('team'))

    expect(platform.launched('syncSegments').filter(({ args }) => args[0] === org.id)).toEqual([
      { job: 'syncSegments', args: [org.id, created.id] },
      { job: 'syncSegments', args: [org.id, created.id] }
    ])
  })

  it("never syncs or reads another organization's segment", async () => {
    const org = await platform.organization('Membership owner')
    const other = await platform.organization('Membership outsider')
    const owned = await segment(org, 'Owned', plan('pro'))
    const { segmentMemberships } = other.services

    await expect(segmentMemberships.sync(owned.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(segmentMemberships.stats(owned.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(
      segmentMemberships.history(owned.id, { page: 1, pageSize: 10 })
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
