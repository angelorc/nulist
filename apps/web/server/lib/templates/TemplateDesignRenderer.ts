import { renderToMjml } from '@templatical/renderer'
import { decodeHTMLStrict } from 'entities'
import { resolveFontStack } from '@templatical/types'
import type { CustomFont, TemplateContent } from '@templatical/types'
import { EMAIL_FONT_FALLBACK, EMAIL_FONTS } from '../../../shared/templates/fonts'
import { ValidationError } from '../core/errors'

/** A `font-family` declaration inside an inline `style="…"` attribute (quotes may be entities). */
const IMAGE_ROLE = /(<mj-image\b[^>]*?)\s+role="presentation"/g

const INLINE_FONT = /(\bstyle="[^"]*?\bfont-family:\s*)((?:&[\da-z#]+;|[^&;"])+)/gi

/**
 * Turns a visual-editor document (Templatical JSON) into MJML. The server
 * renders it itself, so the stored MJML always matches the stored design,
 * whatever MJML the browser sent along.
 */
export class TemplateDesignRenderer {
  /** `fonts`: the web fonts the editor offers, loaded by the email when a block uses one. */
  constructor(
    private readonly fonts: readonly CustomFont[] = EMAIL_FONTS,
    private readonly fallback = EMAIL_FONT_FALLBACK
  ) {}

  async mjml(content: TemplateContent): Promise<string> {
    let mjml: string

    try {
      // Members may add HTML blocks on purpose; the code editor already accepts any MJML.
      mjml = await renderToMjml(content, {
        allowHtmlBlocks: true,
        customFonts: [...this.fonts],
        defaultFallbackFont: this.fallback
      })
    } catch (cause) {
      throw new ValidationError(
        `The email design could not be rendered: ${cause instanceof Error ? cause.message : String(cause)}`,
        { field: 'design' }
      )
    }

    return this.withFontFallbacks(mjml.replace(IMAGE_ROLE, '$1'))
  }

  /**
   * The text toolbar sets a lone font on selected words (`font-family: Geist`):
   * it gets the fallbacks the renderer gives a block's font, so a client without
   * that font shows a similar one instead of its own default.
   */
  private withFontFallbacks(mjml: string): string {
    const fonts = { customFonts: this.fonts, defaultFallback: this.fallback }

    return mjml.replace(INLINE_FONT, (match, declaration: string, value: string) => {
      const family = decodeHTMLStrict(value).trim()
      const stack = resolveFontStack(family, fonts)

      // Names in the stack are single-quoted, so it fits in the double-quoted attribute.
      return stack === family ? match : `${declaration}${stack}`
    })
  }
}
