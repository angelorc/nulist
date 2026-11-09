export type StatusColor = 'success' | 'warning' | 'error' | 'neutral' | 'info'

const STATUS_COLORS = new Map<string, StatusColor>([
  ['active', 'success'],
  ['subscribed', 'success'],
  ['confirmed', 'success'],
  ['delivered', 'success'],
  ['sent', 'success'],
  ['completed', 'success'],
  ['success', 'success'],
  ['processed', 'success'],
  ['pending', 'warning'],
  ['unconfirmed', 'warning'],
  ['queued', 'warning'],
  ['delayed', 'warning'],
  ['scheduled', 'info'],
  ['sending', 'info'],
  ['processing', 'info'],
  ['bounced', 'error'],
  ['complained', 'error'],
  ['failed', 'error'],
  ['rejected', 'error'],
  ['cancelled', 'error'],
  ['error', 'error'],
  ['blocklisted', 'error'],
  ['unsubscribed', 'neutral'],
  ['draft', 'neutral'],
  ['paused', 'neutral'],
  ['suppressed', 'neutral'],
  ['disabled', 'neutral'],
  ['ignored', 'neutral']
])

export function statusColor(status: string | null | undefined): StatusColor {
  return (status ? STATUS_COLORS.get(status) : undefined) ?? 'neutral'
}
