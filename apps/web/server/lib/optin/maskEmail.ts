const MASK = '•••'

/**
 * Partially masks an address for recipient-facing pages, so a forwarded link
 * does not disclose the full email: `jane.doe@example.com` → `ja•••@example.com`.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')

  if (at <= 0) return MASK
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2)

  return `${visible}${MASK}@${domain}`
}
