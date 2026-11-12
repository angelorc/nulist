import {
  createButtonBlock,
  createParagraphBlock,
  createSectionBlock,
  createTableBlock
} from '@templatical/types'
import type { Block, TemplateContent } from '@templatical/types'
import { lintTemplate } from '@templatical/quality'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TEMPLATE_LINT_OPTIONS } from '../shared/templates/lint'
import { MjmlBlockImporter } from '../shared/templates/MjmlBlockImporter'
import { TemplateDesignEnvelope } from '../shared/schemas/template-design'
import { templateCreateSchema, templateDesignSchema } from '../shared/schemas/templates'
import type { TemplateStarter } from '../shared/schemas/templates'
import type { TemplateKind } from '../shared/types/domain'
import { StarterCatalog } from '../server/lib/templates/starters/StarterCatalog'
import { TestPlatform } from './support/platform'
import type { TestOrganization } from './support/platform'

const platform = new TestPlatform()
let org: TestOrganization

beforeAll(async () => {
  org = await platform.organization('Acme Studio')
})

afterAll(() => platform.dispose())

function visualTemplate(name: string, kind: TemplateKind, starter: TemplateStarter) {
  return org.services.templates.create(
    templateCreateSchema.parse({
      name,
      kind,
      starter,
      editor: 'visual',
      slug: kind === 'transactional' ? `${starter}-${kind}` : null
    }),
    org.actor
  )
}

/** A design with one section holding the given blocks. */
function designOf(...blocks: Block[][]): TemplateContent {
  return {
    blocks: [createSectionBlock({ columns: '1', children: blocks })],
    settings: {
      width: 600,
      backgroundColor: '#ffffff',
      textColor: '#1a1a1a',
      linkUnderline: true,
      fontFamily: 'Helvetica',
      locale: 'en'
    }
  }
}

/** Every ready-made email except the empty canvas, with the email type it is written for. */
const STARTERS = (['marketing', 'transactional'] as const).flatMap((kind) =>
  new StarterCatalog()
    .all(kind)
    .filter((starter) => starter.id !== 'blank')
    .map((starter) => ({ kind, starter }))
)

describe('template starters', () => {
  it.each(STARTERS)(
    'the $kind starter $starter.id passes the editor quality checks',
    ({ kind, starter }) => {
      const issues = lintTemplate(starter.build(kind), TEMPLATE_LINT_OPTIONS)

      expect(issues.map((issue) => `${issue.severity} ${issue.ruleId}: ${issue.message}`)).toEqual(
        []
      )
    }
  )

  it.each(STARTERS)(
    'the $kind starter $starter.id compiles cleanly and previews with sample values',
    async ({ kind, starter }) => {
      const template = await visualTemplate(starter.name, kind, starter.id)

      expect(template.warnings).toEqual([])
      expect(
        TemplateDesignEnvelope.read(templateDesignSchema.parse(template.design))
      ).not.toBeNull()
      expect(template.subject).toBe(starter.subject)

      const preview = await org.services.templatePreviewer.preview({
        html: template.html ?? '',
        data: starter.sampleData
      })

      // Every variable is filled in: the sample contact, company details and API data.
      expect(preview.issues).toEqual([])
      expect(preview.html).toContain('Alex')
      expect(preview.html).not.toContain('{{')
      // Marketing email carries the unsubscribe link; transactional email has none.
      expect(preview.html.includes('/u/preview')).toBe(kind === 'marketing')
    }
  )

  it('previews the gallery with the organization company name and sample order data', async () => {
    const general = await org.services.settings.get('general')
    const gallery = await org.services.starterGallery.list('transactional')
    const receipt = gallery.find((starter) => starter.id === 'receipt')

    expect(gallery.map((starter) => starter.id)).toContain('blank')
    expect(receipt?.previewHtml).toContain(general.companyName)
    expect(receipt?.previewHtml).toContain('Linen shirt')
    expect(receipt?.subject).toBe('Your receipt for order #1042')
  })

  it('refuses a starter written for the other type of email', async () => {
    await expect(visualTemplate('Wrong type', 'transactional', 'newsletter')).rejects.toThrow(
      'not available for transactional templates'
    )
  })

  it('gives REST API templates the default layout, but no invented subject or preheader', async () => {
    const created = await org.services.templateApi.create(
      { name: 'From the API', kind: 'marketing', editor: 'code' },
      org.actor
    )

    expect(created.subject).toBe('')
    expect(created.preheader).toBeNull()
    expect(created.mjml).toContain('{{ unsubscribe_url }}')
  })

  it('creates a code template from a starter as readable MJML without a design', async () => {
    const template = await org.services.templates.create(
      templateCreateSchema.parse({ name: 'Coded', starter: 'promotion', editor: 'code' }),
      org.actor
    )

    expect(template.design).toBeNull()
    expect(template.mjml.split('\n').length).toBeGreaterThan(40)
    expect(template.mjml).toContain('{{ unsubscribe_url }}')
  })
})

describe('visual templates', () => {
  it('render their MJML from the saved design, never from the MJML the browser sends', async () => {
    const template = await visualTemplate('Design source', 'marketing', 'blank')

    const design = TemplateDesignEnvelope.wrap(
      designOf([createParagraphBlock({ content: '<p>Written in the editor</p>' })])
    )

    const saved = await org.services.templates.update(
      template.id,
      {
        design,
        mjml: '<mjml><mj-body><mj-section><mj-column><mj-text>Forged</mj-text></mj-column></mj-section></mj-body></mjml>'
      },
      org.actor
    )

    expect(saved.mjml).toContain('Written in the editor')
    expect(saved.mjml).not.toContain('Forged')
    expect(saved.html).toContain('Written in the editor')
    expect(saved.design).toEqual(design)
  })

  it('keep the Liquid loops of a code template that moves to the visual editor', async () => {
    const receipt = new StarterCatalog().resolve('receipt', 'transactional')

    const coded = await org.services.templates.create(
      templateCreateSchema.parse({
        name: 'Coded receipt',
        kind: 'transactional',
        slug: 'coded-receipt',
        starter: 'receipt',
        editor: 'code'
      }),
      org.actor
    )

    const converted = new MjmlBlockImporter().import(coded.mjml)

    const saved = await org.services.templates.update(
      coded.id,
      { editor: 'visual', design: TemplateDesignEnvelope.wrap(converted.content) },
      org.actor
    )

    const preview = await org.services.templatePreviewer.preview({
      html: saved.html ?? '',
      data: receipt.sampleData
    })

    expect(converted.keptAsHtml).toBe(1)
    expect(preview.issues).toEqual([])
    expect(preview.html).toContain('Linen shirt')
    expect(preview.html).toContain('Canvas tote')
    expect(preview.html).not.toContain('The items of the order appear here.')
  })

  it('keep single-quoted Liquid working in a button link', async () => {
    const template = await visualTemplate('Quoted link', 'marketing', 'blank')

    const design = TemplateDesignEnvelope.wrap(
      designOf([
        createButtonBlock({
          text: 'Open',
          url: "{{ contact.website | default: 'https://example.com/fallback' }}"
        }),
        createButtonBlock({
          text: 'Shop',
          url: "{{ data.shop | default: 'https://example.com/?a=1&region=eu' }}"
        })
      ])
    )

    const saved = await org.services.templates.update(template.id, { design }, org.actor)
    const preview = await org.services.templatePreviewer.preview({ html: saved.html ?? '' })

    expect(preview.issues).toEqual([])
    expect(preview.html).toContain('href="https://example.com/fallback"')
    // `&region` is a query parameter, not the `&reg` entity.
    expect(preview.html).toContain('href="https://example.com/?a=1&amp;region=eu"')
  })

  it('keep Liquid working where the editor HTML-encodes it', async () => {
    const template = await visualTemplate('Encoded Liquid', 'marketing', 'blank')

    const design = TemplateDesignEnvelope.wrap(
      designOf([
        createTableBlock({
          hasHeaderRow: false,
          rows: [
            {
              id: 'row',
              cells: [
                { id: 'label', content: 'Name' },
                { id: 'value', content: '{{ contact.first_name | default: "friend" }}' }
              ]
            }
          ]
        })
      ])
    )

    const saved = await org.services.templates.update(template.id, { design }, org.actor)
    const preview = await org.services.templatePreviewer.preview({ html: saved.html ?? '' })

    expect(saved.html).toContain('&quot;friend&quot;')
    expect(preview.issues).toEqual([])
    expect(preview.html).toContain('Alex')
  })
})

/** Older starters set text defaults in the head; Liquid sits around and inside elements. */
const LEGACY_MJML = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-text font-size="15px" line-height="24px" color="#404040" />
    </mj-attributes>
  </mj-head>
  <mj-body>
    {% if data.vip %}
    <mj-section><mj-column><mj-text>VIP corner</mj-text></mj-column></mj-section>
    <mj-section><mj-column><mj-text>Members only</mj-text></mj-column></mj-section>
    {% endif %}
    <mj-section>
      <mj-column>
        <mj-text font-size="22px" color="#171717" align="center">{% if contact.first_name %}Hi {{ contact.first_name }}{% else %}Hi there{% endif %},</mj-text>
        <mj-text>Your order has shipped.</mj-text>
        <mj-table><tr><td>Shipping &amp; handling</td><td>{{ data.plan | default: "Free" }}</td></tr></mj-table>
        <mj-button href="https://example.com/track">Track your order</mj-button>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`

describe('MJML opened in the visual editor', () => {
  async function importAndSave(mjml: string, slug: string) {
    const template = await org.services.templates.create(
      templateCreateSchema.parse({ name: slug, kind: 'transactional', slug, editor: 'code' }),
      org.actor
    )

    const converted = new MjmlBlockImporter().import(mjml)

    const saved = await org.services.templates.update(
      template.id,
      { editor: 'visual', design: TemplateDesignEnvelope.wrap(converted.content) },
      org.actor
    )

    return { converted, saved }
  }

  it('keeps conditions as display conditions, styled Liquid text and plain table text', async () => {
    const { converted, saved } = await importAndSave(LEGACY_MJML, 'legacy-import')

    expect(converted.unsupportedLogic).toBe(0)
    expect(converted.keptAsHtml).toBe(1)
    expect(converted.content.settings.textColor).toBe('#404040')

    const member = await org.services.templatePreviewer.preview({
      html: saved.html ?? '',
      data: { vip: false }
    })

    const vip = await org.services.templatePreviewer.preview({
      html: saved.html ?? '',
      data: { vip: true }
    })

    expect(member.issues).toEqual([])
    expect(member.html).not.toContain('VIP corner')
    expect(member.html).not.toContain('Members only')
    expect(vip.html).toContain('VIP corner')
    expect(vip.html).toContain('Members only')

    // The greeting keeps its size and colour; the following text and button survive.
    expect(member.html).toContain('Hi Alex,')
    expect(member.html).toMatch(/font-size:\s*22px/)
    expect(member.html).toContain('Your order has shipped.')
    expect(member.html).toContain('Track your order')

    // Table text is encoded once, and the Liquid in it still runs.
    expect(member.html).toContain('Shipping &amp; handling')
    expect(member.html).not.toContain('&amp;amp;')
    expect(member.html).toContain('Free')
  })

  it('reports logic around parts that blocks cannot keep, and ignores commented-out logic', () => {
    const importer = new MjmlBlockImporter()

    const section = (text: string) =>
      `<mj-section><mj-column><mj-text>${text}</mj-text></mj-column></mj-section>`

    const loop = importer.import(`<mjml><mj-body>
      {% for item in data.items %}${section('{{ item.name }}')}${section('{{ item.price }}')}{% endfor %}
    </mj-body></mjml>`)

    const branches = importer.import(`<mjml><mj-body>
      {% if data.vip %}${section('VIP')}{% else %}${section('Everyone')}{% endif %}
    </mj-body></mjml>`)

    const legacy = importer.import(`<mjml><mj-body>
      <mj-raw>{% if data.vip %}</mj-raw>${section('VIP')}<mj-raw>{% else %}</mj-raw>${section('Everyone')}<mj-raw>{% endif %}</mj-raw>
    </mj-body></mjml>`)

    const commented = importer.import(`<mjml><mj-body>
      <!-- {% if data.vip %} -->${section('Hello')}
    </mj-body></mjml>`)

    expect(loop.unsupportedLogic).toBe(2)
    expect(branches.unsupportedLogic).toBe(3)
    expect(legacy.unsupportedLogic).toBeGreaterThan(0)
    expect(commented.unsupportedLogic).toBe(0)
  })
})
