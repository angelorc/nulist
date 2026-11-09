import type {
  V1DeletedResource,
  V1Page,
  V1Template,
  V1TemplateCreateInput,
  V1TemplateListQuery,
  V1TemplateSaveResult,
  V1TemplateSummary,
  V1TemplateUpdateInput
} from '../../../shared/schemas/v1'
import type { Actor } from '../core/actor'
import type {
  SavedTemplate,
  TemplateRow,
  TemplateService,
  TemplateSummary
} from '../templates/TemplateService'
import { V1Presenter } from './V1Presenter'

/**
 * REST API v1 templates resource of one organization. Templates are addressed
 * by id or slug; compilation, slug rules and the in-use check stay in
 * TemplateService. Another organization's templates are not found.
 */
export class TemplateApi {
  constructor(private readonly templates: TemplateService) {}

  static summary(row: TemplateSummary): V1TemplateSummary {
    return {
      id: row.id,
      object: 'template',
      name: row.name,
      slug: row.slug,
      kind: row.kind,
      editor: row.editor,
      subject: row.subject,
      preheader: row.preheader,
      createdAt: V1Presenter.iso(row.createdAt),
      updatedAt: V1Presenter.iso(row.updatedAt)
    }
  }

  static present(row: TemplateRow): V1Template {
    return { ...TemplateApi.summary(row), mjml: row.mjml, html: row.html }
  }

  static saved(row: SavedTemplate): V1TemplateSaveResult {
    return { ...TemplateApi.present(row), warnings: row.warnings }
  }

  async list(query: V1TemplateListQuery): Promise<V1Page<V1TemplateSummary>> {
    const rows = await this.templates.list({ kind: query.kind, q: query.q })

    return V1Presenter.page(V1Presenter.slice(rows, query), (row) => TemplateApi.summary(row))
  }

  async get(ref: string): Promise<V1Template> {
    return TemplateApi.present(await this.templates.findByRef(ref))
  }

  async create(input: V1TemplateCreateInput, actor: Actor): Promise<V1TemplateSaveResult> {
    return TemplateApi.saved(await this.templates.create({ ...input, starter: 'default' }, actor))
  }

  async update(
    ref: string,
    input: V1TemplateUpdateInput,
    actor: Actor
  ): Promise<V1TemplateSaveResult> {
    const { id } = await this.templates.findByRef(ref)

    return TemplateApi.saved(await this.templates.update(id, input, actor))
  }

  /** Refused (`invalid_state`) while a scheduled or sending broadcast uses the template. */
  async delete(ref: string, actor: Actor): Promise<V1DeletedResource<'template'>> {
    const { id } = await this.templates.findByRef(ref)
    await this.templates.delete(id, actor)

    return { id, object: 'template', deleted: true }
  }
}
