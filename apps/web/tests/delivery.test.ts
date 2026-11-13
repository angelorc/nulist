import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { Webhook, WebhookVerificationError } from 'standardwebhooks'
import { z } from 'zod'
import { apikey } from '../server/db/schema'
import type { ApiKeyIdentity } from '../server/lib/api/ApiKeyVerifier'
import { ConflictError } from '../server/lib/core/errors'
import type { SnsEnvelope } from '../server/lib/events/SnsVerifier'
import type { DeliveryResult } from '../server/lib/transactional/TransactionalService'
import { WebhookService } from '../server/lib/webhooks/WebhookService'
import { API_KEY_SCOPES } from '../shared/auth/permissions'
import { broadcastCreateSchema } from '../shared/schemas/broadcasts'
import { inboundEventQuerySchema } from '../shared/schemas/logs'
import { transactionalEmailSchema } from '../shared/schemas/transactional'
import type { TransactionalEmailInput } from '../shared/schemas/transactional'
import type { ContactStatus, JsonObject, SuppressionReason } from '../shared/types/domain'
import { TestPlatform } from './support/platform'
import type { TestOrganization } from './support/platform'
import { WebhookReceiver } from './support/WebhookReceiver'

const platform = new TestPlatform()

afterAll(() => platform.dispose())

/** The event part of an SES notification, after `eventType` and `mail`. */
interface SesEventDetail {
  [field: string]: JsonObject
}

/**
 * An SNS delivery of an SES event about a message nulist sent (with the
 * correlation tags MessageSender adds). The signature is already verified.
 */
function sesNotification(
  org: TestOrganization,
  sent: DeliveryResult,
  eventType: string,
  detail: SesEventDetail
): SnsEnvelope {
  const recipient = sent.messageId && sent.providerMessageId ? sent : null

  if (!recipient) throw new Error('The email was not handed to the provider')

  const mail = {
    timestamp: new Date().toISOString(),
    messageId: recipient.providerMessageId,
    destination: [],
    tags: { message_id: [recipient.messageId], organization_id: [org.id] }
  }

  return {
    Type: 'Notification',
    MessageId: randomUUID(),
    TopicArn: 'arn:aws:sns:us-east-1:123456789012:nulist-events',
    Message: JSON.stringify({ eventType, mail, ...detail }),
    Timestamp: new Date().toISOString()
  }
}

/** Event types recorded for an email, in order. */
async function eventsOf(org: TestOrganization, messageId: string): Promise<string[]> {
  return (await org.services.transactional.get(messageId)).events.map((event) => event.type)
}

/** An API key of the organization (the row Better Auth stores). */
async function apiKeyOf(org: TestOrganization): Promise<ApiKeyIdentity> {
  const now = new Date()

  const [row] = await platform.db
    .insert(apikey)
    .values({
      referenceId: org.id,
      key: randomUUID(),
      name: 'Server',
      createdAt: now,
      updatedAt: now
    })
    .returning({ id: apikey.id })

  if (!row) throw new Error('Could not store the API key')

  return {
    id: row.id,
    name: 'Server',
    start: null,
    scope: 'sending',
    organizationId: org.id,
    permissions: API_KEY_SCOPES.sending,
    createdBy: null
  }
}

/** A fatal SES outcome for the recipient and what it must leave behind. */
interface FatalOutcome {
  name: string
  eventType: string
  detail(email: string): SesEventDetail
  reason: SuppressionReason
  contactStatus: ContactStatus
}

const FATAL_OUTCOMES: FatalOutcome[] = [
  {
    name: 'A permanent bounce',
    eventType: 'Bounce',
    detail: (email) => ({
      bounce: {
        bounceType: 'Permanent',
        bounceSubType: 'General',
        bouncedRecipients: [{ emailAddress: email }]
      }
    }),
    reason: 'hard_bounce',
    contactStatus: 'bounced'
  },
  {
    name: 'A complaint',
    eventType: 'Complaint',
    detail: (email) => ({
      complaint: { complainedRecipients: [{ emailAddress: email }], complaintFeedbackType: 'abuse' }
    }),
    reason: 'complaint',
    contactStatus: 'complained'
  }
]

describe('SES events', () => {
  it.each(FATAL_OUTCOMES)(
    '$name suppresses the address only in the organization that sent the email',
    async ({ eventType, detail, reason, contactStatus }) => {
      const sender = await platform.organization('Sender')
      const bystander = await platform.organization('Bystander')
      const email = 'shared@example.test'
      await sender.contact({ email })
      await bystander.contact({ email })
      const sent = await sender.deliverEmail(email)

      const result = await platform.container.sesEvents.handle(
        sesNotification(sender, sent, eventType, detail(email))
      )

      expect(result).toMatchObject({ status: 'processed', messageId: sent.messageId })
      expect((await sender.services.suppressions.find(email))?.reason).toBe(reason)
      expect((await sender.services.contacts.findByEmail(email))?.status).toBe(contactStatus)
      expect((await sender.services.transactional.get(sent.messageId)).status).toBe(contactStatus)
      expect((await sender.deliverEmail(email)).status).toBe('suppressed')

      expect(await bystander.services.suppressions.find(email)).toBeNull()
      expect((await bystander.services.contacts.findByEmail(email))?.status).toBe('active')
      expect((await bystander.deliverEmail(email)).status).toBe('sent')
    }
  )

  it('does not suppress after a single transient bounce', async () => {
    const org = await platform.organization('Soft bounce')
    const email = 'full-mailbox@example.test'
    const contact = await org.contact({ email })
    const sent = await org.deliverEmail(email)

    const bounce = sesNotification(org, sent, 'Bounce', {
      bounce: {
        bounceType: 'Transient',
        bounceSubType: 'MailboxFull',
        bouncedRecipients: [{ emailAddress: email }]
      }
    })

    expect((await platform.container.sesEvents.handle(bounce)).status).toBe('processed')
    expect(await org.services.suppressions.find(email)).toBeNull()
    expect(await org.services.contacts.findOrFail(contact.id)).toMatchObject({
      status: 'active',
      softBounceCount: 1
    })
  })

  it('records delivery, opens and clicks once per SNS notification', async () => {
    const org = await platform.organization('Engagement events')
    const email = 'reader@example.test'
    const contact = await org.contact({ email })
    const sent = await org.deliverEmail(email)
    const browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15'

    const notifications = [
      sesNotification(org, sent, 'Delivery', { delivery: { recipients: [email] } }),
      sesNotification(org, sent, 'Open', { open: { userAgent: browser, isBotEvent: 'Unlikely' } }),
      sesNotification(org, sent, 'Click', {
        click: {
          link: 'https://example.test/offer',
          linkTags: null,
          userAgent: browser,
          isBotEvent: 'Unlikely'
        }
      })
    ]

    for (const notification of notifications)
      expect((await platform.container.sesEvents.handle(notification)).status).toBe('processed')

    // SNS delivers at least once: redeliveries of the same notifications are ignored.
    for (const notification of notifications) {
      expect(await platform.container.sesEvents.handle(notification)).toMatchObject({
        status: 'ignored',
        reason: 'Duplicate SNS message'
      })
    }

    const message = await org.services.transactional.get(sent.messageId)

    expect(message.status).toBe('delivered')
    expect([message.deliveredAt, message.openedAt, message.clickedAt]).not.toContain(null)
    expect(await eventsOf(org, sent.messageId)).toEqual(['send', 'delivery', 'open', 'click'])
    expect((await org.services.contacts.findOrFail(contact.id)).lastOpenedAt).not.toBeNull()

    // A genuine second open is a new notification and is counted.
    await platform.container.sesEvents.handle(
      sesNotification(org, sent, 'Open', { open: { userAgent: browser } })
    )

    expect(await eventsOf(org, sent.messageId)).toEqual([
      'send',
      'delivery',
      'open',
      'click',
      'open'
    ])

    const opens = await org.services.logs.inboundEvents(
      inboundEventQuerySchema.parse({ eventType: 'Open' })
    )

    expect(opens.total).toBe(2)
    expect(opens.items.map((event) => event.eventType)).toEqual(['Open', 'Open'])
  })
})

describe('broadcast drafts', () => {
  it('are named after their subject when no name is given, else stay untitled', async () => {
    const org = await platform.organization('Broadcast names')

    const create = async (input: z.input<typeof broadcastCreateSchema>) =>
      (await org.services.broadcasts.create(broadcastCreateSchema.parse(input), org.actor)).name

    expect(await create({ name: 'Launch', subject: 'Spring sale' })).toBe('Launch')
    expect(await create({ name: '  ', subject: 'Spring sale' })).toBe('Spring sale')
    expect(await create({ subject: 'Spring sale' })).toBe('Spring sale')
    expect(await create({})).toBe('Untitled broadcast')
  })
})

describe('transactional API', () => {
  it('replays a retried request with the same Idempotency-Key and rejects a different body', async () => {
    const org = await platform.organization('Idempotency')
    const key = await apiKeyOf(org)
    const { transactional } = org.services

    const order: TransactionalEmailInput = transactionalEmailSchema.parse({
      to: 'buyer@example.test',
      subject: 'Order #1042',
      html: '<p>Thanks for your order</p>',
      data: { order: 1042, items: ['book'] }
    })

    const first = await transactional.send({ ...order, idempotencyKey: 'order-1042' }, key)

    // The retry serialises its JSON keys in another order: still the same request.
    const retried = transactionalEmailSchema.parse(
      JSON.parse(
        JSON.stringify({ data: order.data, html: order.html, subject: order.subject, to: order.to })
      )
    )

    const replay = await transactional.send({ ...retried, idempotencyKey: 'order-1042' }, key)

    expect(first.replayed).toBe(false)
    expect(replay).toEqual({ email: first.email, replayed: true })
    expect(
      platform.launched('sendTransactional').filter(({ args }) => args[0] === org.id)
    ).toHaveLength(1)

    const changed = transactional.send(
      { ...order, subject: 'Order #1043', idempotencyKey: 'order-1042' },
      key
    )

    await expect(changed).rejects.toBeInstanceOf(ConflictError)
    await expect(changed).rejects.toMatchObject({ status: 409, code: 'invalid_idempotent_request' })

    // Idempotency keys belong to one API key: another key may reuse the value.
    const other = await transactional.send(
      { ...order, idempotencyKey: 'order-1042' },
      await apiKeyOf(org)
    )

    expect(other.replayed).toBe(false)
    expect(other.email.id).not.toBe(first.email.id)
  })
})

describe('outbound webhooks', () => {
  it('signs each delivery so the receiver can verify exactly that payload', async () => {
    const receiver = await WebhookReceiver.start()

    try {
      const org = await platform.organization('Webhooks')

      const endpoint = await org.services.webhookService.createEndpoint({
        url: receiver.url,
        events: ['contact.created']
      })

      await org.contact({ email: 'hooked@example.test' })

      const deliveries = platform
        .launched('deliverWebhook')
        .filter(({ args }) => args[0] === org.id)
        .map(({ args }) => z.string().parse(args[1]))

      expect(deliveries).toHaveLength(1)
      expect(await org.services.webhookService.attempt(deliveries[0]!)).toMatchObject({
        ok: true,
        status: 204
      })

      const [request] = receiver.received

      if (!request) throw new Error('The endpoint received nothing')
      const receiverSide = new Webhook(endpoint.secret)

      expect(receiverSide.verify(request.body, request.headers)).toMatchObject({
        type: 'contact.created',
        data: { email: 'hooked@example.test' }
      })
      expect(request.headers['webhook-id']).toBe(deliveries[0])
      expect(() =>
        receiverSide.verify(request.body.replace('hooked@', 'forged@'), request.headers)
      ).toThrow(WebhookVerificationError)
      expect(() =>
        new Webhook(WebhookService.generateSecret()).verify(request.body, request.headers)
      ).toThrow(WebhookVerificationError)
    } finally {
      await receiver.stop()
    }
  })
})
