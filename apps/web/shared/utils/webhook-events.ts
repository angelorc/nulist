export const WEBHOOK_EVENTS = [
  { type: 'email.sent', description: 'The provider accepted the email' },
  { type: 'email.delivered', description: 'The recipient mail server accepted the email' },
  { type: 'email.delivery_delayed', description: 'Delivery is temporarily delayed' },
  { type: 'email.bounced', description: 'The email bounced (hard or soft)' },
  { type: 'email.complained', description: 'The recipient marked the email as spam' },
  { type: 'email.opened', description: 'The recipient opened the email' },
  { type: 'email.clicked', description: 'The recipient clicked a link' },
  { type: 'email.failed', description: 'Sending failed permanently' },
  { type: 'email.suppressed', description: 'Not sent because the address is suppressed' },
  { type: 'contact.created', description: 'A contact was created' },
  { type: 'contact.updated', description: 'A contact was updated' },
  { type: 'contact.deleted', description: 'A contact was deleted' },
  { type: 'contact.subscribed', description: 'A contact confirmed a list subscription' },
  { type: 'contact.unsubscribed', description: 'A contact unsubscribed from a list or globally' },
  { type: 'broadcast.sent', description: 'A broadcast finished sending' }
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number]['type']
