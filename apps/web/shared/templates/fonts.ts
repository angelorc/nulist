import type { CustomFont, FontsConfig } from '@templatical/types'

/** Fonts used after a font an email client may not have (the editor's own default). */
export const EMAIL_FONT_FALLBACK = 'Arial, sans-serif'

/**
 * Web fonts offered next to the editor's built-in ones. Email clients that
 * cannot load web fonts (Outlook on Windows, some webmail) show the fallback.
 */
export const EMAIL_FONTS: readonly CustomFont[] = [
  {
    name: 'Geist',
    url: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap',
    fallback: 'Arial, Helvetica, sans-serif'
  }
]

/** The font picker's options: every built-in font plus {@link EMAIL_FONTS}. */
export const EMAIL_FONTS_CONFIG: FontsConfig = {
  customFonts: [...EMAIL_FONTS],
  defaultFallback: EMAIL_FONT_FALLBACK
}
