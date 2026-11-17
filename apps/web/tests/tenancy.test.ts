import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NotFoundError, ValidationError } from '../server/lib/core/errors'
import { broadcastCreateSchema } from '../shared/schemas/broadcasts'
import { segmentInputSchema } from '../shared/schemas/segments'
import type { SegmentConditionState } from '../shared/schemas/segments'
import { templateCreateSchema } from '../shared/schemas/templates'
import { topicInputSchema } from '../shared/schemas/topics'
import { TestPlatform } from './support/platform'
import type { TestOrganization } from './support/platform'

/** One kind of tenant data: created in an organization, then probed from another one. */
interface IsolatedResource {
  name: string
  /** Creates the record in `owner` and returns the key routes address it by. */
  create(owner: TestOrganization): Promise<string>
  /** Reads the record by key (NotFoundError when it is not the organization's). */
  read(org: TestOrganization, key: string): Promise<void>
  /** Deletes the record by key (NotFoundError when it is not the organization's). */
  remove(org: TestOrganization, key: string): Promise<void>
}

interface ForeignReference {
  name: string
  create(owner: TestOrganization): Promise<string>
  condition(id: string): SegmentConditionState
  property: string
}

async function createSegment(org: TestOrganization, name: string): Promise<string> {
  const input = segmentInputSchema.parse({ name, rules: { conditions: [] } })

  return (await org.services.segments.create(input, org.actor)).id
}

const RESOURCES: IsolatedResource[] = [
  {
    name: 'contacts',
    create: async (owner) => (await owner.contact({ email: 'shared@example.test' })).id,
    read: async (org, id) => void (await org.services.contacts.get(id)),
    remove: (org, id) => org.services.contacts.delete(id, org.actor)
  },
  {
    name: 'lists',
    create: async (owner) => (await owner.list('Customers')).id,
    read: async (org, id) => void (await org.services.lists.get(id)),
    remove: (org, id) => org.services.lists.delete(id, org.actor)
  },
  {
    name: 'templates',
    create: async (owner) => (await owner.newsletterTemplate()).id,
    read: async (org, id) => void (await org.services.templates.get(id)),
    remove: (org, id) => org.services.templates.delete(id, org.actor)
  },
  {
    name: 'broadcasts',
    create: async (owner) =>
      (
        await owner.services.broadcasts.create(
          broadcastCreateSchema.parse({ name: 'Launch' }),
          owner.actor
        )
      ).id,
    read: async (org, id) => void (await org.services.broadcasts.get(id)),
    remove: (org, id) => org.services.broadcasts.delete(id, org.actor)
  },
  {
    name: 'segments',
    create: (owner) => createSegment(owner, 'Everyone'),
    read: async (org, id) => void (await org.services.segments.get(id)),
    remove: (org, id) => org.services.segments.delete(id, org.actor)
  },
  {
    name: 'suppressions',
    create: async (owner) =>
      (await owner.services.suppressionAdmin.add('blocked@example.test', owner.actor)).email,
    read: async (org, email) => {
      if (!(await org.services.suppressions.find(email))) throw new NotFoundError('Suppression')
    },
    remove: async (org, email) =>
      void (await org.services.suppressionAdmin.remove(email, org.actor))
  }
]

const REFERENCES: ForeignReference[] = [
  {
    name: 'segment',
    create: (owner) => createSegment(owner, 'Owner segment'),
    condition: (id) => ({ field: 'segment', operator: 'in_segment', value: id }),
    property: 'value'
  },
  {
    name: 'topic',
    create: async (owner) =>
      (
        await owner.services.topics.create(
          topicInputSchema.parse({ name: 'Owner topic' }),
          owner.actor
        )
      ).id,
    condition: (id) => ({ field: 'topic', operator: 'subscribed_topic', value: id }),
    property: 'value'
  },
  {
    name: 'broadcast',
    create: async (owner) =>
      (
        await owner.services.broadcasts.create(
          broadcastCreateSchema.parse({ name: 'Owner launch' }),
          owner.actor
        )
      ).id,
    condition: (id) => ({
      field: 'activity',
      operator: 'has',
      event: 'opened',
      scope: 'broadcast',
      broadcastId: id
    }),
    property: 'broadcastId'
  },
  {
    name: 'template',
    create: async (owner) =>
      (
        await owner.services.templates.create(
          templateCreateSchema.parse({
            name: 'Owner receipt',
            kind: 'transactional',
            slug: 'owner-receipt',
            editor: 'code'
          }),
          owner.actor
        )
      ).id,
    condition: (id) => ({
      field: 'activity',
      operator: 'has',
      event: 'delivered',
      scope: 'transactional',
      templateId: id
    }),
    property: 'templateId'
  }
]

describe('tenant isolation', () => {
  const platform = new TestPlatform()
  let owner: TestOrganization
  let other: TestOrganization

  beforeAll(async () => {
    owner = await platform.organization('Owner')
    other = await platform.organization('Other')
  })

  afterAll(() => platform.dispose())

  it.each(RESOURCES)(
    '$name of one organization are not found from another one',
    async (resource) => {
      const key = await resource.create(owner)

      await expect(resource.read(other, key)).rejects.toBeInstanceOf(NotFoundError)
      await expect(resource.remove(other, key)).rejects.toBeInstanceOf(NotFoundError)
      // Still there for its owner after the foreign delete attempt.
      await expect(resource.read(owner, key)).resolves.toBeUndefined()
    }
  )

  it.each(REFERENCES)(
    'never lets a segment refer to another organization’s $name',
    async (reference) => {
      const id = await reference.create(owner)

      const input = segmentInputSchema.parse({
        name: 'Borrowed',
        rules: {
          conditions: [
            {
              match: 'any',
              conditions: [{ field: 'email', operator: 'is_set' }, reference.condition(id)]
            }
          ]
        }
      })

      await expect(other.services.segments.create(input, other.actor)).rejects.toMatchObject({
        code: 'validation_error',
        data: {
          issues: [
            {
              path: ['conditions', '0', 'conditions', '1', reference.property],
              message: `Choose a ${reference.name}`
            }
          ]
        }
      })
    }
  )

  it('never lets a broadcast exclude another organization’s segment', async () => {
    const foreignSegment = await createSegment(owner, 'Owner exclusions')
    await other.contact({ email: 'kept@example.test' })

    await expect(
      other.services.broadcasts.create(
        broadcastCreateSchema.parse({ audience: { excludeSegmentIds: [foreignSegment] } }),
        other.actor
      )
    ).rejects.toBeInstanceOf(ValidationError)

    const everyone = await createSegment(other, 'Everyone here')

    const audience = {
      listIds: [],
      segmentIds: [everyone],
      excludeListIds: [],
      excludeSegmentIds: [foreignSegment]
    }

    expect(await other.services.broadcasts.estimate(audience)).toBe(1)
  })

  it('never lets an organization subscribe to, or send to, another organization’s list', async () => {
    const foreignList = await owner.list('Owner subscribers')
    await owner.contact({ email: 'subscriber@example.test', listIds: [foreignList.id] })
    const contact = await other.contact({ email: 'reader@example.test' })

    const audience = {
      listIds: [foreignList.id],
      segmentIds: [],
      excludeListIds: [],
      excludeSegmentIds: []
    }

    await expect(
      other.services.contacts.subscribe(contact.id, foreignList.id, other.actor)
    ).rejects.toBeInstanceOf(NotFoundError)

    await expect(
      other.services.broadcasts.create(
        broadcastCreateSchema.parse({ audience: { listIds: [foreignList.id] } }),
        other.actor
      )
    ).rejects.toBeInstanceOf(ValidationError)

    // An audience id smuggled in anyway selects nobody outside its organization.
    expect(await owner.services.broadcasts.estimate(audience)).toBe(1)
    expect(await other.services.broadcasts.estimate(audience)).toBe(0)
  })
})
