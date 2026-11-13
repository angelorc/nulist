import type { MergeTag, TemplateContent } from '@templatical/types'
import { z } from 'zod'
import type { TemplateKind } from '#shared/types/domain'

interface TagSpec extends MergeTag {
  /** Email types the variable is filled in for. */
  kinds: readonly TemplateKind[]
}

const BOTH = ['marketing', 'transactional'] as const
const MARKETING = ['marketing'] as const

/**
 * The Liquid variables of the visual editor, in plain language: authors pick
 * "First name" from a list and see that label on the canvas, while the email
 * keeps the Liquid tag. Samples are what Preview shows in their place.
 */
const TAGS: readonly TagSpec[] = [
  {
    label: 'First name',
    value: '{{ contact.first_name | default: "there" }}',
    group: 'Contact',
    description: 'Shows "there" when the contact has no first name',
    sample: 'Alex',
    kinds: BOTH
  },
  {
    label: 'Last name',
    value: '{{ contact.last_name }}',
    group: 'Contact',
    description: "The contact's last name",
    sample: 'Morgan',
    kinds: BOTH
  },
  {
    label: 'Email address',
    value: '{{ contact.email }}',
    group: 'Contact',
    description: 'The address this email is sent to',
    sample: 'alex@example.com',
    kinds: BOTH
  },
  {
    label: 'Company name',
    value: '{{ company.name }}',
    group: 'Your company',
    description: 'From Settings → General',
    sample: 'Your company',
    kinds: BOTH
  },
  {
    label: 'Company address',
    value: '{{ company.address }}',
    group: 'Your company',
    description: 'Postal address from Settings → General (required by anti-spam laws)',
    sample: '1 Main Street, Springfield',
    kinds: BOTH
  },
  {
    label: 'Unsubscribe link',
    value: '{{ unsubscribe_url }}',
    group: 'Links',
    description: 'One-click unsubscribe: required in every marketing email',
    kinds: MARKETING
  },
  {
    label: 'Manage preferences link',
    value: '{{ preferences_url }}',
    group: 'Links',
    description: 'Lets contacts choose which emails they receive',
    kinds: BOTH
  },
  {
    label: 'View in browser link',
    value: '{{ web_url }}',
    group: 'Links',
    description: 'Opens this email as a web page',
    kinds: MARKETING
  }
]

/** `{{ data.order_id }}` and friends: values a transactional API request sends. */
const DATA_TAG = /\{\{\s*data\.([a-z0-9_]+(?:\.[a-z0-9_]+)*)\s*(?:\|[^}]*)?\}\}/gi

const jsonText = z.string()

export class TemplateMergeTags {
  constructor(private readonly kind: TemplateKind) {}

  /**
   * The tags offered for this email type, plus one per API data value the
   * content already uses (transactional), so those read as words too.
   */
  for(content: TemplateContent): MergeTag[] {
    const tags: MergeTag[] = TAGS.flatMap(({ kinds, ...tag }) =>
      kinds.includes(this.kind) ? [tag] : []
    )

    if (this.kind !== 'transactional') return tags

    const seen = new Set<string>()

    // Tags are found in the serialised document; each match is a JSON string fragment.
    for (const [fragment, path] of JSON.stringify(content).matchAll(DATA_TAG)) {
      const value = jsonText.parse(JSON.parse(`"${fragment}"`))

      if (!path || seen.has(value)) continue
      seen.add(value)
      tags.push({
        label: TemplateMergeTags.labelOf(path),
        value,
        group: 'API data',
        description: `Sent with the API request as data.${path}`
      })
    }

    return tags
  }

  /** `order_id` → "Order id", `shipping.address` → "Shipping address". */
  static labelOf(path: string): string {
    const words = path.replace(/[._]+/g, ' ').trim()

    return words.charAt(0).toUpperCase() + words.slice(1)
  }
}
