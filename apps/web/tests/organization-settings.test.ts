import { and, eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { settings } from '../server/db/schema'
import { LimitExceededError, ValidationError } from '../server/lib/core/errors'
import { MASKED_SECRET } from '../shared/schemas/settings'
import { transactionalEmailSchema } from '../shared/schemas/transactional'
import type { SettingsSection } from '../shared/types/domain'
import { TestPlatform } from './support/platform'
import type { TestOrganization } from './support/platform'

const platform = new TestPlatform()

afterAll(() => platform.dispose())

/** A transactional email request as POST /api/v1/emails accepts it. */
function receipt(to: string) {
  return transactionalEmailSchema.parse({ to, subject: 'Receipt', html: '<p>Thanks!</p>' })
}

/** The stored JSON of a settings section (secrets as written at rest). */
async function storedSection(org: TestOrganization, section: SettingsSection): Promise<string> {
  const [row] = await platform.db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.organizationId, org.id), eq(settings.key, section)))

  return JSON.stringify(row?.value ?? null)
}

describe('limits', () => {
  it('stops creating contacts at maxContacts, in the dashboard and in imports', async () => {
    const org = await platform.organization('Contact quota')
    await org.setLimits({ maxContacts: 3 })
    await org.contact({ email: 'one@example.test' })
    await org.contact({ email: 'two@example.test' })

    const result = await org.importCsv({
      fileName: 'more.csv',
      csv: 'email\nthree@example.test\nfour@example.test\n',
      mapping: { email: 'email' }
    })

    expect(result).toMatchObject({ createdCount: 1, errorCount: 1 })
    expect(result.errors).toEqual([
      expect.objectContaining({
        email: 'four@example.test',
        message: expect.stringMatching(/limit/i)
      })
    ])

    const blocked = org.contact({ email: 'five@example.test' })

    await expect(blocked).rejects.toBeInstanceOf(LimitExceededError)
    await expect(blocked).rejects.toMatchObject({
      status: 403,
      data: { limit: 'contacts', used: 3, max: 3 }
    })
    // Updating an existing contact is not creating one.
    await expect(
      org.services.contacts.upsert({ email: 'one@example.test', firstName: 'Uno' }, org.actor)
    ).resolves.toMatchObject({ created: false })
  })

  it('rejects the email past the daily sending limit', async () => {
    const org = await platform.organization('Send quota')
    await org.setLimits({ dailySendLimit: 2 })

    expect((await org.deliverEmail('first@example.test')).status).toBe('sent')
    expect((await org.deliverEmail('second@example.test')).status).toBe('sent')
    await expect(
      org.services.transactional.send(receipt('third@example.test'), null)
    ).rejects.toMatchObject({
      code: 'limit_exceeded',
      data: { limit: 'sending', used: 2, max: 2 }
    })
  })

  it('counts accepted but undelivered emails against the daily sending limit', async () => {
    const org = await platform.organization('Queued quota')
    await org.setLimits({ dailySendLimit: 2 })
    const { transactional } = org.services

    await transactional.send(receipt('first@example.test'), null)
    await transactional.send(receipt('second@example.test'), null)

    await expect(transactional.send(receipt('third@example.test'), null)).rejects.toBeInstanceOf(
      LimitExceededError
    )
  })
})

describe('settings secrets', () => {
  it('keeps a masked SMTP password only while the SMTP server stays the same', async () => {
    const org = await platform.organization('SMTP secret')
    const { settings: section } = org.services
    const current = await section.get('sending')

    await section.update('sending', {
      ...current,
      smtp: { ...current.smtp, host: 'smtp.acme.test', port: 587, user: 'mailer', pass: 'p@ssw0rd' }
    })

    const stored = await storedSection(org, 'sending')

    expect(stored).not.toContain('p@ssw0rd')
    expect(stored).toContain('enc:v1:')

    const masked = await section.getMasked('sending')

    expect(masked.smtp.pass).toBe(MASKED_SECRET)
    await section.update('sending', { ...masked, ratePerSecond: 5 })
    expect((await section.get('sending')).smtp.pass).toBe('p@ssw0rd')

    const redirected = section.update('sending', {
      ...masked,
      smtp: { ...masked.smtp, host: 'smtp.attacker.test' }
    })

    await expect(redirected).rejects.toBeInstanceOf(ValidationError)
    await expect(redirected).rejects.toMatchObject({ data: { field: 'smtp.pass' } })
    expect((await section.get('sending')).smtp).toMatchObject({
      host: 'smtp.acme.test',
      pass: 'p@ssw0rd'
    })
  })

  it('rejects an SES SMTP password as the secret access key and trims a pasted key', async () => {
    const org = await platform.organization('SES secret')
    const { settings: section } = org.services
    const current = await section.get('sending')
    const ses = { ...current.ses, region: 'eu-west-1', accessKeyId: 'AKIAEXAMPLEEXAMPLE12' }
    const smtpPassword = 'BAbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/AbCdE'

    await expect(
      section.preview('sending', {
        ...current,
        provider: 'ses',
        ses: { ...ses, secretAccessKey: smtpPassword }
      })
    ).rejects.toMatchObject({ data: { field: 'ses.secretAccessKey' } })

    const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    await section.update('sending', {
      ...current,
      provider: 'ses',
      ses: { ...ses, secretAccessKey: ` ${secret}\n` }
    })
    expect((await section.get('sending')).ses.secretAccessKey).toBe(secret)
  })

  it('never reveals the instance S3 secret and asks for a new one when the endpoint or bucket changes', async () => {
    const org = await platform.organization('S3 secret')
    const { settings: section } = org.services
    const masked = await section.getMasked('storage')

    expect(masked.secretAccessKey).toBe(MASKED_SECRET)
    await section.update('storage', { ...masked, publicUrl: 'https://cdn.acme.test' })
    expect(await section.get('storage')).toMatchObject({
      publicUrl: 'https://cdn.acme.test',
      secretAccessKey: 'instance-secret'
    })

    // The instance's credentials never follow an organization to another bucket.
    await expect(
      section.update('storage', { ...masked, bucket: 'acme-assets' })
    ).rejects.toMatchObject({ data: { field: 'secretAccessKey' } })

    await expect(
      section.update('storage', { ...masked, endpoint: 'https://s3.attacker.test' })
    ).rejects.toMatchObject({ data: { field: 'secretAccessKey' } })

    await section.update('storage', {
      ...masked,
      endpoint: 'https://s3.acme.test',
      secretAccessKey: 'acme-secret'
    })
    expect((await section.get('storage')).secretAccessKey).toBe('acme-secret')
  })
})
