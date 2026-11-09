/** Escapes LIKE/ILIKE wildcards so user text is matched literally (Postgres' default escape is `\`). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** `%term%` for substring search, with wildcards in the user input escaped. */
export function containsPattern(term: string): string {
  return `%${escapeLike(term)}%`
}
