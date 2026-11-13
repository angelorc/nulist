import type { StarterPreviewDto } from '../../../../shared/schemas/templates'
import type { TemplateKind } from '../../../../shared/types/domain'
import type { TemplateDesignRenderer } from '../TemplateDesignRenderer'
import type { TemplatePreviewer } from '../TemplatePreviewer'
import type { TemplateRenderer } from '../TemplateRenderer'
import type { StarterCatalog, StarterDefinition } from './StarterCatalog'

/** Compiled starter HTML is the same for every organization: compile each one once per process. */
const compiled = new Map<string, Promise<string>>()

/**
 * The "Start from" choices of a new template, each with a preview rendered the
 * way a recipient would see it: the organization's company details and sample
 * contact and API data in place of the variables.
 */
export class StarterGallery {
  constructor(
    private readonly catalog: StarterCatalog,
    private readonly designs: TemplateDesignRenderer,
    private readonly renderer: TemplateRenderer,
    private readonly previewer: TemplatePreviewer
  ) {}

  async list(kind: TemplateKind): Promise<StarterPreviewDto[]> {
    return Promise.all(
      this.catalog.all(kind).map(async (starter) => {
        const preview = await this.previewer.preview({
          html: await this.html(starter, kind),
          subject: starter.subject,
          preheader: starter.preheader,
          data: starter.sampleData
        })

        return {
          id: starter.id,
          name: starter.name,
          description: starter.description,
          subject: preview.subject,
          previewHtml: starter.id === 'blank' ? null : preview.html
        }
      })
    )
  }

  private html(starter: StarterDefinition, kind: TemplateKind): Promise<string> {
    const key = `${starter.id}:${kind}`
    let html = compiled.get(key)

    if (!html) {
      html = this.designs
        .mjml(starter.build(kind))
        .then((mjml) => this.renderer.compileMjml(mjml))
        .then((result) => result.html)
      // A failed compile is retried on the next request instead of being cached.
      void html.catch(() => compiled.delete(key))
      compiled.set(key, html)
    }

    return html
  }
}
