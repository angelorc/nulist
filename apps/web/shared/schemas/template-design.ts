import { z } from 'zod'
import type { TemplateContent } from '@templatical/types'
import type { TemplateDesign } from './templates'

/** The shape of an editor document; its blocks are validated by the editor and the renderer. */
const editorDocumentSchema = z.object({
  blocks: z.array(z.json()),
  settings: z.record(z.string(), z.json())
})

/**
 * How a visual template is stored in `templates.design`: the Templatical
 * document wrapped in a small envelope, so older project data (GrapesJS) is
 * recognisable and is rebuilt from the template's MJML instead of being loaded.
 */
const templaticalDesignSchema = z.object({
  format: z.literal('templatical'),
  version: z.literal(1),
  content: z.custom<TemplateContent>((value) => editorDocumentSchema.safeParse(value).success)
})

export class TemplateDesignEnvelope {
  static readonly FORMAT = 'templatical'

  static readonly VERSION = 1

  /** The stored form of an editor document. */
  static wrap(content: TemplateContent): TemplateDesign {
    return {
      format: TemplateDesignEnvelope.FORMAT,
      version: TemplateDesignEnvelope.VERSION,
      content: z.json().parse(content)
    }
  }

  /** The editor document inside `design`, or `null` for anything else (no design, GrapesJS data). */
  static read(design: TemplateDesign | null | undefined): TemplateContent | null {
    const parsed = templaticalDesignSchema.safeParse(design)

    return parsed.success ? parsed.data.content : null
  }

  static isTemplatical(design: TemplateDesign | null | undefined): boolean {
    return templaticalDesignSchema.safeParse(design).success
  }
}

/** What the visual editor hands back on save. */
export interface TemplaticalEditorContent {
  /** MJML rendered from the document (the server renders it again from `design`). */
  mjml: string
  design: TemplateDesign
}

/** Handle the visual editor gives its page once it has loaded. */
export interface TemplaticalEditorApi {
  getContent: () => Promise<TemplaticalEditorContent | null>
  /** Whether the document differs from the one opened or last marked saved (undo included). */
  isChanged: () => boolean
  /** Records `design` (from `getContent`) as saved; later edits still count as changes. */
  markSaved: (design: TemplateDesign) => void
}
