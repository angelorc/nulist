import type { PageParams } from './common'

export type TemplateKind = 'marketing' | 'transactional'

export type TemplateEditor = 'visual' | 'code'

export interface TemplateSummary {
  id: string
  object: 'template'
  name: string
  /** Used as `template` in `emails.send`; transactional templates always have one. */
  slug: string | null
  kind: TemplateKind
  editor: TemplateEditor
  subject: string
  preheader: string | null
  createdAt: string
  updatedAt: string
}

/** A template with its MJML source and compiled HTML (Liquid still unrendered). */
export interface Template extends TemplateSummary {
  mjml: string
  html: string | null
}

/** A non-blocking problem found while compiling MJML or parsing Liquid. */
export interface TemplateIssue {
  source: 'mjml' | 'liquid'
  line: number | null
  message: string
  tagName?: string
}

/** The result of `templates.create` and `templates.update`. */
export interface SavedTemplate extends Template {
  warnings: TemplateIssue[]
}

export interface CreateTemplateOptions {
  name: string
  /** Default `marketing`; transactional templates need a `slug`. */
  kind?: TemplateKind
  /** Default `code`. */
  editor?: TemplateEditor
  /** kebab-case, unique in the organization, e.g. `password-reset`. */
  slug?: string | null
  subject?: string
  preheader?: string | null
  /** MJML with Liquid; omit to start from the default layout. */
  mjml?: string
}

export interface UpdateTemplateOptions {
  name?: string
  kind?: TemplateKind
  editor?: TemplateEditor
  slug?: string | null
  subject?: string
  preheader?: string | null
  mjml?: string
}

export interface ListTemplatesOptions extends PageParams {
  kind?: TemplateKind
  /** Matches the name, slug or subject. */
  q?: string
}
