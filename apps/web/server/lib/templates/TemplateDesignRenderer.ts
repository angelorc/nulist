import { renderToMjml } from '@templatical/renderer'
import type { TemplateContent } from '@templatical/types'
import { ValidationError } from '../core/errors'

/**
 * Turns a visual-editor document (Templatical JSON) into MJML. The server
 * renders it itself, so the stored MJML always matches the stored design,
 * whatever MJML the browser sent along.
 */
export class TemplateDesignRenderer {
  async mjml(content: TemplateContent): Promise<string> {
    try {
      // Members may add HTML blocks on purpose; the code editor already accepts any MJML.
      return await renderToMjml(content, { allowHtmlBlocks: true })
    } catch (cause) {
      throw new ValidationError(
        `The email design could not be rendered: ${cause instanceof Error ? cause.message : String(cause)}`,
        { field: 'design' }
      )
    }
  }
}
