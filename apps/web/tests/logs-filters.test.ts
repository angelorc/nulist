import { afterAll, describe, expect, it } from 'vitest'
import { schema } from '../server/db/client'
import { auditQuerySchema, emailLogQuerySchema } from '../shared/schemas/logs'
import type { ActorType } from '../shared/types/logs'
import type { MessageKind, MessageStatus } from '../shared/types/domain'
import { TestPlatform } from './support/platform'
import type { TestOrganization } from './support/platform'

const platform = new TestPlatform()

afterAll(() => platform.dispose())

interface MessageFixture {
  to: string
  status: MessageStatus
  kind?: MessageKind
  opens?: number
  clicks?: number
  at?: string
}

async function messages(org: TestOrganization, fixtures: MessageFixture[]): Promise<void> {
  await platform.db.insert(schema.messages).values(
    fixtures.map((fixture) => ({
      organizationId: org.id,
      kind: fixture.kind ?? 'transactional',
      toEmail: fixture.to,
      fromEmail: 'news@example.test',
      subject: 'Hello',
      status: fixture.status,
      openCount: fixture.opens ?? 0,
      clickCount: fixture.clicks ?? 0,
      createdAt: fixture.at ? new Date(fixture.at) : new Date()
    }))
  )
}

describe('email log filters', () => {
  it('counts each facet without its own selection and keeps selected values listed', async () => {
    const org = await platform.organization('Email facets')
    const other = await platform.organization('Email facets elsewhere')

    await messages(org, [
      { to: 'a@example.test', status: 'delivered', opens: 2, clicks: 1 },
      { to: 'b@example.test', status: 'bounced' },
      { to: 'c@example.test', status: 'delivered', kind: 'broadcast', opens: 1 },
      { to: 'd@example.test', status: 'failed', kind: 'system' }
    ])
    await messages(other, [{ to: 'x@example.test', status: 'bounced' }])

    const { facets } = await org.services.logs.emailFacets(
      emailLogQuerySchema.parse({ status: 'bounced,cancelled' })
    )

    expect(facets.status).toEqual([
      { value: 'delivered', label: null, count: 2 },
      { value: 'bounced', label: null, count: 1 },
      { value: 'failed', label: null, count: 1 },
      { value: 'cancelled', label: null, count: 0 }
    ])
    expect(facets.kind).toEqual([{ value: 'transactional', label: null, count: 1 }])
    expect(facets.engagement).toEqual([{ value: 'none', label: null, count: 1 }])

    const engaged = await org.services.logs.emailFacets(
      emailLogQuerySchema.parse({ engagement: 'opened' })
    )

    expect(engaged.facets.engagement.map((bucket) => [bucket.value, bucket.count])).toEqual([
      ['none', 2],
      ['clicked', 1],
      ['opened', 1]
    ])
    expect(engaged.facets.status).toEqual([{ value: 'delivered', label: null, count: 1 }])
  })

  it('matches one recipient exactly and names a selected broadcast that matches nothing', async () => {
    const org = await platform.organization('Email recipient')
    const other = await platform.organization('Email recipient elsewhere')

    const [launch] = await platform.db
      .insert(schema.broadcasts)
      .values({ organizationId: org.id, name: 'Launch' })
      .returning({ id: schema.broadcasts.id })

    const [foreign] = await platform.db
      .insert(schema.broadcasts)
      .values({ organizationId: other.id, name: 'Foreign' })
      .returning({ id: schema.broadcasts.id })

    await messages(org, [
      { to: 'Bob@example.test', status: 'bounced' },
      { to: 'jimbob@example.test', status: 'bounced' }
    ])

    const query = emailLogQuerySchema.parse({
      recipient: 'bob@example.test',
      broadcastId: `${launch?.id},${foreign?.id}`
    })

    const { facets } = await org.services.logs.emailFacets(query)

    expect(facets.broadcastId).toEqual([
      { value: launch?.id, label: 'Launch', count: 0 },
      { value: foreign?.id, label: null, count: 0 }
    ])

    const page = await org.services.logs.emails({ ...query, broadcastId: undefined })

    expect(page.items.map((item) => item.toEmail)).toEqual(['Bob@example.test'])
  })

  it('lists a custom range ending in the future up to now', async () => {
    const org = await platform.organization('Email future range')
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString()

    await messages(org, [{ to: 'recent@example.test', status: 'delivered', at: day(-200) }])

    const page = await org.services.logs.emails(
      emailLogQuerySchema.parse({ from: day(-300).slice(0, 10), to: day(400).slice(0, 10) })
    )

    expect(page.items.map((item) => item.toEmail)).toEqual(['recent@example.test'])
  })

  it('lists whole custom days in either order with several statuses', async () => {
    const org = await platform.organization('Email range')

    await messages(org, [
      { to: 'before@example.test', status: 'delivered', at: '2026-02-28T23:59:59Z' },
      { to: 'first@example.test', status: 'delivered', at: '2026-03-01T00:00:00Z' },
      { to: 'failed@example.test', status: 'failed', at: '2026-03-02T12:00:00Z' },
      { to: 'last@example.test', status: 'bounced', at: '2026-03-03T23:59:59Z' },
      { to: 'after@example.test', status: 'delivered', at: '2026-03-04T00:00:00Z' }
    ])

    const query = emailLogQuerySchema.parse({
      from: '2026-03-03',
      to: '2026-03-01',
      status: 'delivered,bounced'
    })

    const page = await org.services.logs.emails(query)

    expect(page.items.map((item) => item.toEmail)).toEqual([
      'last@example.test',
      'first@example.test'
    ])

    const stats = await org.services.logs.emailStats(query)

    expect(stats.window).toEqual({
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-03-04T00:00:00.000Z',
      period: null
    })
    expect(stats.bucket).toBe('day')
    expect(stats.volume.map((point) => [point.at, point.ok + point.issues + point.other])).toEqual([
      ['2026-03-01', 1],
      ['2026-03-02', 1],
      ['2026-03-03', 1]
    ])
  })
})

describe('audit filters', () => {
  it('filters by several actor types and counts actors across them', async () => {
    const org = await platform.organization('Audit facets')

    const entries: [ActorType, string][] = [
      ['user', 'list'],
      ['api_key', 'contact'],
      ['api_key', 'list'],
      ['system', 'contact']
    ]

    await platform.db.insert(schema.auditLogs).values(
      entries.map(([actorType, entityType]) => ({
        organizationId: org.id,
        actorType,
        action: `${entityType}.updated`,
        entityType,
        summary: `facet probe ${entityType}`
      }))
    )

    const query = auditQuerySchema.parse({ q: 'facet probe', actorType: 'user,api_key' })
    const page = await org.services.audit.list(query)

    expect(page.total).toBe(3)

    const { facets } = await org.services.audit.facets(query)

    expect(
      Object.fromEntries(facets.actorType.map((bucket) => [bucket.value, bucket.count]))
    ).toEqual({ api_key: 2, system: 1, user: 1 })
    expect(facets.entityType.map((bucket) => [bucket.value, bucket.count])).toEqual([
      ['list', 2],
      ['contact', 1]
    ])
  })
})
