import type { TemplateIssue, TemplatePreviewResult } from '../../../shared/schemas/templates'
import type { JsonObject } from '../../../shared/types/domain'
import { DomainError } from '../core/errors'
import type { SettingsService } from '../settings/SettingsService'
import { TemplateIssues } from './TemplateIssues'
import type { ContactVariables, RenderVariables, TemplateRenderer } from './TemplateRenderer'
import type { TenantScope } from '../core/TenantScope'

export interface PreviewSource {
  /** MJML source (compiled first). */
  mjml?: string
  /** Already compiled HTML (used when `mjml` is absent). */
  html?: string
  subject?: string
  preheader?: string | null
  /** Sample `data.*` payload for transactional templates. */
  data?: JsonObject
}

export interface SampleOverrides {
  contact?: Partial<ContactVariables>
  data?: JsonObject
}

/** Placeholder recipient used for previews and test sends. */
export const SAMPLE_CONTACT: ContactVariables = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'alex@example.com',
  first_name: 'Alex',
  last_name: 'Morgan',
  attributes: { company: 'Example Co', plan: 'pro', city: 'Lisbon' }
}

/**
 * Renders template content with realistic sample variables (sample contact,
 * company details from the organization's Settings → General, placeholder
 * recipient links). Never throws on bad content: problems come back as `issues`.
 * Reads no tenant rows itself: it is organization-specific through `settings`.
 */
export class TemplatePreviewer {
  constructor(
    protected readonly scope: TenantScope,
    private readonly renderer: TemplateRenderer,
    private readonly settings: SettingsService,
    private readonly baseUrl: string
  ) {}

  async sampleVariables(overrides: SampleOverrides = {}): Promise<RenderVariables> {
    const general = await this.settings.get('general')
    const base = this.baseUrl.replace(/\/+$/, '')

    return {
      contact: { ...SAMPLE_CONTACT, ...overrides.contact },
      data: overrides.data ?? {},
      unsubscribe_url: `${base}/u/preview`,
      preferences_url: `${base}/preferences/preview`,
      web_url: `${base}/view/preview`,
      company: { name: general.companyName, address: general.companyAddress }
    }
  }

  async preview(
    source: PreviewSource,
    overrides: SampleOverrides = {}
  ): Promise<TemplatePreviewResult> {
    const issues: TemplateIssue[] = []
    const subject = source.subject ?? ''
    let html = source.html ?? ''

    if (source.mjml !== undefined) {
      try {
        this.renderer.assertLiquid(source.mjml, 'content')
      } catch (error) {
        issues.push(TemplateIssues.fromLiquid(error))
      }

      try {
        const compiled = await this.renderer.compileMjml(source.mjml)
        html = compiled.html
        issues.push(...TemplateIssues.fromMjml(compiled.issues))
      } catch (error) {
        issues.push({
          source: 'mjml',
          line: null,
          message: error instanceof DomainError ? error.message : 'MJML could not be compiled'
        })

        return { html: '', subject, issues }
      }
    }

    if (issues.some((issue) => issue.source === 'liquid')) return { html, subject, issues }

    try {
      const prepared = await this.renderer.prepare({
        subject,
        html,
        preheader: source.preheader ?? null
      })

      const rendered = await prepared.render(
        await this.sampleVariables({ data: source.data, ...overrides })
      )

      return { html: rendered.html, subject: rendered.subject, issues }
    } catch (error) {
      issues.push(TemplateIssues.fromLiquid(error))

      return { html, subject, issues }
    }
  }

  /** Rendered HTML only (thumbnails); falls back to the raw HTML when Liquid fails. */
  async thumbnail(html: string): Promise<string> {
    return (await this.preview({ html })).html || html
  }
}
