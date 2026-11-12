import { convert } from 'html-to-text'
import { decodeHTMLStrict } from 'entities'
import { Liquid } from 'liquidjs'
import type { LiquidOptions, Scope, Template } from 'liquidjs'
import mjml2html from 'mjml'
import type { JsonObject, JsonValue, UtmSettings } from '../../../shared/types/domain'
import { ValidationError } from '../core/errors'

/**
 * The recipient as Liquid sees it (`{{ contact.first_name }}`). A plain object
 * type (not an interface) so it is a JSON value and can be stored with the message.
 */
export type ContactVariables = {
  id?: string
  email: string
  first_name?: string | null
  last_name?: string | null
  attributes?: JsonObject
}

/** Company details from Settings → General (`{{ company.name }}`). */
export type CompanyVariables = {
  name: string
  address: string
}

/**
 * Variables available to Liquid in every template (see shared/utils/template-variables.ts).
 * Every value is JSON, so the variables a message was rendered with can be stored on it.
 */
export interface RenderVariables {
  contact?: ContactVariables | null
  data?: JsonObject
  unsubscribe_url?: string
  preferences_url?: string
  web_url?: string
  company?: CompanyVariables
  [key: string]: JsonValue | undefined
}

/**
 * Options shared by both engines. Templates are written by organization members
 * and API clients, so Liquid must never touch the server:
 * - `templates: {}` is an empty in-memory file system, so `{% include %}`,
 *   `{% render %}` and `{% layout %}` cannot read files from the server's disk;
 * - the limits bound the parse size, render time and allocations (ranges,
 *   string filters) of one call, which liquidjs leaves unlimited by default.
 */
const LIQUID_OPTIONS = {
  ownPropertyOnly: true,
  cache: 500,
  templates: {},
  /** Characters parsed per `parse()` call. */
  parseLimit: 10_000_000,
  /** Milliseconds per `render()` call. */
  renderLimit: 2_000,
  /** Allocation units (range items, string lengths) per `render()` call. */
  memoryLimit: 10_000_000
} as const satisfies LiquidOptions

/** The message of a thrown value (library errors are not always `Error` instances). */
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export interface MjmlIssue {
  line: number
  message: string
  tagName: string
}

export interface MjmlCompileResult {
  html: string
  issues: MjmlIssue[]
}

export interface PrepareInput {
  subject: string
  /** Compiled HTML (may contain Liquid tags). */
  html: string
  preheader?: string | null
  utm?: UtmSettings | null
  /** Links starting with this prefix (our own unsubscribe/preferences links) are never tagged. */
  ownUrlPrefix?: string
}

/**
 * A template parsed once and rendered many times (one per recipient).
 * Created by TemplateRenderer.prepare().
 */
export class PreparedEmail {
  constructor(
    private readonly htmlEngine: Liquid,
    private readonly textEngine: Liquid,
    private readonly subject: Template[],
    private readonly html: Template[],
    private readonly input: PrepareInput
  ) {}

  /**
   * Renders for one recipient. Templates written by users get `RenderVariables`;
   * built-in emails (system mail, opt-in) pass their own Liquid scope objects.
   */
  async render(vars: RenderVariables | Scope): Promise<RenderedEmail> {
    const [subject, rawHtml] = await Promise.all([
      this.textEngine.render(this.subject, vars),
      this.htmlEngine.render(this.html, vars)
    ])

    let html = this.input.utm?.enabled
      ? applyUtm(rawHtml, this.input.utm, this.input.ownUrlPrefix)
      : rawHtml

    const text = htmlToText(html)

    if (this.input.preheader) {
      const preheader = await this.textEngine.parseAndRender(
        LiquidMarkup.decodeTags(this.input.preheader),
        vars
      )

      html = injectPreheader(html, preheader)
    }

    return { subject: subject.replace(/\s+/g, ' ').trim(), html, text }
  }
}

/**
 * Compiles MJML to HTML and renders Liquid variables. Output in HTML context
 * is escaped by default (`{{ value | raw }}` opts out), subjects are plain text.
 */
export class TemplateRenderer {
  private readonly htmlEngine = new Liquid({ ...LIQUID_OPTIONS, outputEscape: 'escape' })
  private readonly textEngine = new Liquid(LIQUID_OPTIONS)

  async compileMjml(mjml: string): Promise<MjmlCompileResult> {
    try {
      const result = await mjml2html(mjml, { validationLevel: 'soft', keepComments: false })

      return {
        html: result.html,
        issues: (result.errors ?? []).map((e) => ({
          line: e.line,
          message: e.message,
          tagName: e.tagName
        }))
      }
    } catch (error) {
      throw new ValidationError(`MJML could not be compiled: ${errorMessage(error)}`)
    }
  }

  /** Throws a ValidationError with the Liquid parse error, if any. */
  assertLiquid(source: string, field = 'template'): void {
    try {
      this.htmlEngine.parse(LiquidMarkup.decodeTags(source))
    } catch (error) {
      throw new ValidationError(`Invalid ${field} syntax: ${errorMessage(error)}`, { field })
    }
  }

  async prepare(input: PrepareInput): Promise<PreparedEmail> {
    this.assertLiquid(input.subject, 'subject')
    this.assertLiquid(input.html, 'content')

    return new PreparedEmail(
      this.htmlEngine,
      this.textEngine,
      this.textEngine.parse(LiquidMarkup.decodeTags(input.subject)),
      this.htmlEngine.parse(LiquidMarkup.decodeTags(input.html)),
      input
    )
  }

  async renderText(source: string, vars: RenderVariables): Promise<string> {
    return this.textEngine.parseAndRender(source, vars)
  }

  /** Static checks used by pre-flight checklists. */
  inspect(html: string) {
    const links = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '')

    return {
      hasUnsubscribeLink:
        /\{\{\s*unsubscribe_url\b/.test(html) || /\{\{\s*preferences_url\b/.test(html),
      hasCompanyAddress: /\{\{\s*company\.address\b/.test(html),
      emptyLinks: links.filter((l) => !l || l === '#').length,
      linkCount: links.length,
      sizeKb: Math.round(Buffer.byteLength(html, 'utf8') / 1024)
    }
  }
}

const LIQUID_TAG = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g

/** A no-break space: `&nbsp;` decoded. Liquid only knows ordinary spaces. */
const NO_BREAK_SPACE = /\u00a0/g

/**
 * Liquid written in the visual editor reaches the HTML entity-encoded: a table
 * cell or a link turns `default: "there"` into `default: &quot;there&quot;`,
 * and `'there'` into `&#039;there&#039;`.
 * Entities never mean anything inside a Liquid tag, and the tag is replaced by
 * its value when rendered, so decoding them inside `{{ }}` / `{% %}` is safe
 * and keeps hand-written Liquid working wherever it was typed. Only complete
 * entities (ending in `;`) are decoded: `?id=1&region=eu` in a URL stays as written.
 */
export class LiquidMarkup {
  static decodeTags(source: string): string {
    if (!source.includes('&')) return source

    return source.replace(LIQUID_TAG, (tag) => decodeHTMLStrict(tag).replace(NO_BREAK_SPACE, ' '))
  }
}

export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: 100,
    selectors: [
      { selector: 'img', format: 'skip' },
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } }
    ]
  }).trim()
}

export function injectPreheader(html: string, preheader: string): string {
  const hidden = `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`

  return /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (m) => m + hidden) : hidden + html
}

export function applyUtm(html: string, utm: UtmSettings, ownUrlPrefix?: string): string {
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, raw: string) => {
    const decoded = raw.replace(/&amp;/g, '&')

    if (ownUrlPrefix && decoded.startsWith(ownUrlPrefix)) return match

    try {
      const url = new URL(decoded)

      const params: [string, string | undefined][] = [
        ['utm_source', utm.source],
        ['utm_medium', utm.medium ?? 'email'],
        ['utm_campaign', utm.campaign]
      ]

      for (const [key, value] of params) {
        if (value && !url.searchParams.has(key)) url.searchParams.set(key, value)
      }

      return `href="${url.toString().replace(/&/g, '&amp;')}"`
    } catch {
      return match
    }
  })
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
