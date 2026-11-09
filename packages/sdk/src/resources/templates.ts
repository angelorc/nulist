import type { RequestOptions } from '../core/request-options'
import { RequestPath } from '../core/request-path'
import type { MlistResponse } from '../core/response'
import type { Transport } from '../core/transport'
import type { DeletedResource, Page } from '../types/common'
import type {
  CreateTemplateOptions,
  ListTemplatesOptions,
  SavedTemplate,
  Template,
  TemplateSummary,
  UpdateTemplateOptions
} from '../types/templates'

/** MJML + Liquid templates, addressed by id or slug. */
export class Templates {
  constructor(private readonly transport: Transport) {}

  create(
    payload: CreateTemplateOptions,
    options: RequestOptions = {}
  ): Promise<MlistResponse<SavedTemplate>> {
    return this.transport.post<SavedTemplate, CreateTemplateOptions>(
      RequestPath.of('/templates'),
      payload,
      options
    )
  }

  get(idOrSlug: string, options: RequestOptions = {}): Promise<MlistResponse<Template>> {
    return this.transport.get<Template>(
      RequestPath.of('/templates/{id}', { id: idOrSlug }),
      options
    )
  }

  /** Most recently updated first, without the content. */
  list(
    params: ListTemplatesOptions = {},
    options: RequestOptions = {}
  ): Promise<MlistResponse<Page<TemplateSummary>>> {
    return this.transport.get<Page<TemplateSummary>>(RequestPath.of('/templates'), {
      ...options,
      query: { page: params.page, pageSize: params.pageSize, kind: params.kind, q: params.q }
    })
  }

  /** Returns MJML warnings; invalid Liquid fails with `validation_error`. */
  update(
    idOrSlug: string,
    payload: UpdateTemplateOptions,
    options: RequestOptions = {}
  ): Promise<MlistResponse<SavedTemplate>> {
    return this.transport.patch<SavedTemplate, UpdateTemplateOptions>(
      RequestPath.of('/templates/{id}', { id: idOrSlug }),
      payload,
      options
    )
  }

  /** Refused (`invalid_state`) while a scheduled or sending broadcast uses the template. */
  remove(
    idOrSlug: string,
    options: RequestOptions = {}
  ): Promise<MlistResponse<DeletedResource<'template'>>> {
    return this.transport.delete<DeletedResource<'template'>>(
      RequestPath.of('/templates/{id}', { id: idOrSlug }),
      options
    )
  }
}
