import { z } from 'zod'

/** Most colours an organization keeps, so the row under every colour picker stays short. */
export const SAVED_COLOR_LIMIT = 24

/**
 * A hex colour, stored as `#rrggbb` in lower case: `#ABC`, `abc` and `#AABBCC`
 * are the same saved colour `#aabbcc`.
 */
export const savedColorSchema = z
  .string()
  .trim()
  .regex(/^#?(?:[\da-f]{3}|[\da-f]{6})$/i, 'Use a hex colour such as #4f46e5')
  .transform((value) => {
    const hex = value.replace('#', '').toLowerCase()

    // `abc` is short for `aabbcc`.
    return `#${hex.length === 3 ? hex.replaceAll(/./g, '$&$&') : hex}`
  })

export const savedColorInputSchema = z.object({ color: savedColorSchema })

/** The colour of a `DELETE /api/templates/saved-colors/:color` path, without its `#`. */
export const savedColorParamsSchema = z.object({ color: savedColorSchema })
