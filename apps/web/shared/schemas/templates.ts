import { z } from 'zod'
import type { TemplateEditor, TemplateKind } from '../types/domain'

/** kebab-case identifier used by the transactional API (`template: "password-reset"`). */
export const TEMPLATE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const templateKindSchema = z.enum(['marketing', 'transactional'])
export const templateEditorSchema = z.enum(['visual', 'code'])

/** Ready-made emails a template can start from; `default` picks the general one of its type. */
export const templateStarterSchema = z.enum([
  'default',
  'blank',
  'newsletter',
  'announcement',
  'promotion',
  'event',
  'welcome',
  'confirm-email',
  'password-reset',
  'receipt',
  'shipping',
  'notification'
])

export type TemplateStarter = z.infer<typeof templateStarterSchema>

export const starterListQuerySchema = z.object({ kind: z.enum(['marketing', 'transactional']) })

/** A ready-made email shown in the "New template" gallery. */
export interface StarterPreviewDto {
  id: Exclude<TemplateStarter, 'default'>
  name: string
  description: string
  /** Suggested subject, rendered with sample values. */
  subject: string
  /** Rendered with sample values; `null` for the blank canvas. */
  previewHtml: string | null
}

export const templateSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Use at least 2 characters')
  .max(64, 'Use at most 64 characters')
  .regex(TEMPLATE_SLUG_PATTERN, 'Use lowercase letters, numbers and dashes, e.g. password-reset')

export const MAX_MJML = 1_000_000

export const templateCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    kind: templateKindSchema.default('marketing'),
    editor: templateEditorSchema.default('visual'),
    slug: templateSlugSchema.nullish(),
    starter: templateStarterSchema.default('default'),
    subject: z.string().trim().max(300).optional()
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'transactional' && !value.slug) {
      ctx.addIssue({
        code: 'custom',
        path: ['slug'],
        message: 'Transactional templates need a slug'
      })
    }
  })

export type TemplateCreateInput = z.infer<typeof templateCreateSchema>

export type TemplateCreateFormState = z.input<typeof templateCreateSchema>

/**
 * The visual editor's document (see `TemplateDesignEnvelope`); templates saved
 * before it hold GrapesJS project data, which is rebuilt from their MJML.
 */
export const templateDesignSchema = z
  .record(z.string(), z.json())
  .refine((design) => JSON.stringify(design).length <= MAX_MJML * 2, {
    message: 'This email is too long. Remove some blocks and save again.'
  })

export type TemplateDesign = z.infer<typeof templateDesignSchema>

export const templateUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    kind: templateKindSchema,
    editor: templateEditorSchema,
    slug: templateSlugSchema.nullable(),
    subject: z.string().trim().max(300),
    preheader: z.string().trim().max(300).nullable(),
    mjml: z.string().min(1, 'Content is required').max(MAX_MJML),
    design: templateDesignSchema.nullable()
  })
  .partial()

export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>

export const templateListQuerySchema = z.object({
  kind: templateKindSchema.optional(),
  q: z.string().trim().max(200).optional(),
  /** Include `previewHtml` (rendered with sample variables) for thumbnails. */
  preview: z.stringbool().optional()
})

export type TemplateListQuery = z.infer<typeof templateListQuerySchema>

export const templatePreviewSchema = z
  .object({
    mjml: z.string().max(MAX_MJML).optional(),
    html: z
      .string()
      .max(MAX_MJML * 2)
      .optional(),
    subject: z.string().max(300).optional(),
    preheader: z.string().max(300).nullish(),
    /** Sample `data.*` variables (transactional payload). */
    data: z.record(z.string(), z.json()).optional()
  })
  .refine((value) => value.mjml !== undefined || value.html !== undefined, {
    message: 'Provide mjml or html'
  })

export type TemplatePreviewInput = z.infer<typeof templatePreviewSchema>

export const templateTestSchema = z.object({
  to: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'))
})

export type TemplateTestInput = z.infer<typeof templateTestSchema>

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** A non-blocking problem found while compiling MJML or parsing Liquid. */
export interface TemplateIssue {
  source: 'mjml' | 'liquid'
  line: number | null
  message: string
  tagName?: string
}

export interface TemplatePreviewResult {
  html: string
  subject: string
  issues: TemplateIssue[]
}

export interface TemplateSummaryDto {
  id: string
  name: string
  slug: string | null
  kind: TemplateKind
  editor: TemplateEditor
  subject: string
  preheader: string | null
  createdAt: string
  updatedAt: string
  /** Present when listed with `preview=1`. */
  previewHtml?: string
}

export interface TemplateDto extends Omit<TemplateSummaryDto, 'previewHtml'> {
  mjml: string
  html: string | null
  /** The visual editor's document (older templates may hold GrapesJS data, rebuilt on open). */
  design: TemplateDesign | null
}

export interface TemplateSaveResult extends TemplateDto {
  warnings: TemplateIssue[]
}

export interface TemplateTestResult {
  messageId: string
  status: 'sent' | 'suppressed' | 'failed'
  error?: string
}

// ---------------------------------------------------------------------------
// Helpers shared by the API and the editor UI
// ---------------------------------------------------------------------------

/** "Order shipped!" → "order-shipped" */
export function slugifyTemplateName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '')
}

/** MJML tags whose content is markup/text and must be kept verbatim. */
const VERBATIM_TAGS = new Set([
  'mj-text',
  'mj-button',
  'mj-raw',
  'mj-table',
  'mj-navbar-link',
  'mj-social-element',
  'mj-style',
  'mj-title',
  'mj-preview',
  'mj-accordion-title',
  'mj-accordion-text',
  'mj-html-attribute'
])

const MJML_TAG = /<(\/?)(mjml|mj-[a-z0-9-]+)([^>]*)>/gi

/**
 * Pretty-prints MJML structure (one tag per line, nested indentation) while
 * keeping the content of text-like tags untouched. Used for the MJML exported
 * by the visual editor, which comes out as a single line.
 */
export class MjmlFormatter {
  constructor(private readonly indentUnit = '  ') {}

  format(source: string): string {
    const lines: string[] = []
    let depth = 0
    let cursor = 0
    const pad = () => this.indentUnit.repeat(Math.max(depth, 0))

    const pushText = (text: string) => {
      const trimmed = text.trim()

      if (trimmed) lines.push(pad() + trimmed)
    }

    const re = new RegExp(MJML_TAG.source, 'gi')
    let match: RegExpExecArray | null

    while ((match = re.exec(source))) {
      pushText(source.slice(cursor, match.index))
      const [, closing, rawName = '', rawAttrs = ''] = match
      const name = rawName.toLowerCase()
      const selfClosing = rawAttrs.trimEnd().endsWith('/')
      const attrs = selfClosing ? rawAttrs.trimEnd().slice(0, -1).trimEnd() : rawAttrs.trimEnd()

      if (closing) {
        depth--
        lines.push(`${pad()}</${name}>`)
        cursor = re.lastIndex
        continue
      }

      if (selfClosing) {
        lines.push(`${pad()}<${name}${attrs} />`)
        cursor = re.lastIndex
        continue
      }

      const closeTag = `</${name}>`
      const nextClose = source.toLowerCase().indexOf(closeTag, re.lastIndex)
      const inner = nextClose === -1 ? null : source.slice(re.lastIndex, nextClose)

      // Empty element → self-closing
      if (inner !== null && !inner.trim()) {
        lines.push(`${pad()}<${name}${attrs} />`)
        cursor = re.lastIndex = nextClose + closeTag.length
        continue
      }

      if (VERBATIM_TAGS.has(name) && inner !== null) {
        const content = inner.trim()

        if (!content.includes('\n')) {
          lines.push(`${pad()}<${name}${attrs}>${content}${closeTag}`)
        } else {
          lines.push(`${pad()}<${name}${attrs}>`)
          depth++

          for (const line of content.split('\n')) pushText(line)
          depth--
          lines.push(`${pad()}${closeTag}`)
        }

        cursor = re.lastIndex = nextClose + closeTag.length
        continue
      }

      lines.push(`${pad()}<${name}${attrs}>`)
      depth++
      cursor = re.lastIndex
    }

    pushText(source.slice(cursor))

    return lines.join('\n')
  }
}
