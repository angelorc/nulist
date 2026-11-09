import { NotFoundError, ValidationError } from '../core/errors'
import type { TenantScope } from '../core/TenantScope'
import type { TemplateService } from '../templates/TemplateService'

/** Unrendered email content (Liquid not yet applied). */
export interface EmailContent {
  subject: string
  html: string
  /** Explicit plain-text part; derived from the HTML when null. */
  text: string | null
  preheader: string | null
  templateId: string | null
}

/** Strategy: where the content of a transactional email comes from. */
export interface EmailContentSource {
  load(): Promise<EmailContent>
}

/** A saved transactional template of the organization, addressed by id or slug. */
export class TemplateContentSource implements EmailContentSource {
  constructor(
    protected readonly scope: TenantScope,
    private readonly templates: TemplateService,
    private readonly ref: string
  ) {}

  async load(): Promise<EmailContent> {
    const template = await this.templates.findByRef(this.ref)

    // Another organization's template behaves exactly like a missing one.
    if (!this.scope.owns(template.organizationId)) throw new NotFoundError('Template', this.ref)

    if (template.kind !== 'transactional') {
      throw new ValidationError(
        `"${template.name}" is a marketing template. Send transactional email with a transactional template, or pass html.`,
        { field: 'template' }
      )
    }

    return {
      subject: template.subject || template.name,
      html: await this.templates.compiledHtml(template),
      text: null,
      preheader: template.preheader,
      templateId: template.id
    }
  }
}

/** HTML (and optional text) supplied in the request. */
export class RawHtmlContentSource implements EmailContentSource {
  constructor(
    private readonly subject: string,
    private readonly html: string,
    private readonly text: string | null = null
  ) {}

  async load(): Promise<EmailContent> {
    return {
      subject: this.subject,
      html: this.html,
      text: this.text,
      preheader: null,
      templateId: null
    }
  }
}
