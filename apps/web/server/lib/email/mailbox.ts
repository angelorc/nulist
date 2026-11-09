/**
 * RFC 5322 mailbox: `"Acme" <hello@acme.com>`, or the bare address without a name.
 * The display name is quoted (commas and dots are safe), quotes and backslashes are
 * escaped and line breaks removed so a name can never inject headers.
 */
export function formatMailbox(name: string | null | undefined, email: string): string {
  const display = (name ?? '').replace(/[\r\n]+/g, ' ').trim()

  return display ? `"${display.replace(/["\\]/g, '\\$&')}" <${email}>` : email
}
