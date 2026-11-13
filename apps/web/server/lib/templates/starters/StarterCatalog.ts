import { ValidationError } from '../../core/errors'
import type { TemplateContent } from '@templatical/types'
import type { TemplateStarter } from '../../../../shared/schemas/templates'
import type { JsonObject, TemplateKind } from '../../../../shared/types/domain'
import {
  EmailDesignKit,
  PLACEHOLDER_URL,
  spacing
} from '../../../../shared/templates/EmailDesignKit'
import type { StarterPalette } from '../../../../shared/templates/EmailDesignKit'

/** A ready-made email a new template can start from. */
export interface StarterDefinition {
  id: Exclude<TemplateStarter, 'default'>
  /** The email type it is written for (`blank` fits both). */
  kind: TemplateKind | null
  name: string
  description: string
  /** Suggested subject and preheader, used when the creator leaves them empty. */
  subject: string
  preheader: string
  /** Sample `data.*` payload for previews of transactional starters. */
  sampleData?: JsonObject
  build: (kind: TemplateKind) => TemplateContent
}

const INK: StarterPalette = {
  page: '#f4f4f5',
  card: '#ffffff',
  heading: '#18181b',
  text: '#3f3f46',
  muted: '#52525b',
  accent: '#18181b',
  onAccent: '#ffffff',
  soft: '#f4f4f5',
  line: '#e4e4e7'
}

const INDIGO: StarterPalette = {
  page: '#eef2ff',
  card: '#ffffff',
  heading: '#1e1b4b',
  text: '#3f3f46',
  muted: '#4b5563',
  accent: '#4f46e5',
  onAccent: '#ffffff',
  soft: '#eef2ff',
  line: '#e0e7ff'
}

const EMBER: StarterPalette = {
  page: '#fff7ed',
  card: '#ffffff',
  heading: '#431407',
  text: '#44403c',
  muted: '#57534e',
  accent: '#c2410c',
  onAccent: '#ffffff',
  soft: '#ffedd5',
  line: '#fed7aa'
}

const VIOLET: StarterPalette = {
  page: '#f5f3ff',
  card: '#ffffff',
  heading: '#2e1065',
  text: '#3f3f46',
  muted: '#52525b',
  accent: '#6d28d9',
  onAccent: '#ffffff',
  soft: '#ede9fe',
  line: '#ddd6fe'
}

const EMERALD: StarterPalette = {
  page: '#ecfdf5',
  card: '#ffffff',
  heading: '#064e3b',
  text: '#374151',
  muted: '#4b5563',
  accent: '#047857',
  onAccent: '#ffffff',
  soft: '#d1fae5',
  line: '#a7f3d0'
}

const SLATE: StarterPalette = {
  page: '#f1f5f9',
  card: '#ffffff',
  heading: '#0f172a',
  text: '#334155',
  muted: '#475569',
  accent: '#1d4ed8',
  onAccent: '#ffffff',
  soft: '#f1f5f9',
  line: '#e2e8f0'
}

const TEAL: StarterPalette = { ...SLATE, accent: '#0f766e', soft: '#f0fdfa', line: '#ccfbf1' }

const GREETING = 'Hi {{ contact.first_name | default: "there" }},'

// Marketing -------------------------------------------------------------------

function newsletter(kind: TemplateKind): TemplateContent {
  const kit = new EmailDesignKit(INK, 'Georgia')

  const article = (title: string, summary: string) => [
    kit.image('Article image', { padding: spacing(0, 0, 12, 0) }),
    kit.label(title, { size: 19, padding: spacing(0, 0, 8, 0) }),
    kit.text(summary),
    kit.text(`<p><a href="${PLACEHOLDER_URL}"><strong>Read the story →</strong></a></p>`)
  ]

  return kit.document([
    kit.header(kind),
    kit.card([
      kit.text(kit.muted('Issue #1 · Monthly update')),
      kit.title('The latest from {{ company.name }}'),
      kit.text(
        `${GREETING} here is what happened this month: what we shipped, what we learned and what is coming next.`
      ),
      kit.image('Cover image', { padding: spacing(8, 0, 4, 0) })
    ]),
    kit.gap(),
    kit.columns('2', [
      article(
        'What we shipped',
        'Summarise your biggest update in two or three sentences. Tell readers why it matters to them.'
      ),
      article(
        'Behind the scenes',
        'Share a story, a lesson or a number your readers will find interesting.'
      )
    ]),
    kit.gap(),
    kit.card([
      kit.title('One more thing', { level: 2 }),
      kit.text(
        'End with a single, clear next step: a reply, an event, a survey or something new to try.'
      ),
      kit.button('Explore what is new', PLACEHOLDER_URL)
    ]),
    kit.footer(kind, { social: true })
  ])
}

function announcement(kind: TemplateKind): TemplateContent {
  const kit = new EmailDesignKit(INDIGO)
  const { palette } = kit

  const feature = (title: string, text: string) => [kit.label(title), kit.text(text)]

  return kit.document([
    kit.header(kind),
    kit.card(
      [
        kit.text(
          '<p style="text-align: center"><span style="color: #c7d2fe"><strong>New</strong></span></p>'
        ),
        kit.title('Meet our newest feature', {
          align: 'center',
          color: '#ffffff',
          padding: spacing(0, 0, 12, 0)
        }),
        kit.text(
          '<p style="text-align: center"><span style="color: #e0e7ff">One sentence on what it is and the problem it solves for your customers.</span></p>'
        ),
        kit.button('See it in action', PLACEHOLDER_URL, {
          align: 'center',
          background: '#ffffff',
          color: palette.accent
        })
      ],
      { background: '#312e81', padding: spacing(48, 40, 40, 40) }
    ),
    kit.gap(),
    kit.card([kit.image('Product screenshot', { padding: spacing(0) })], {
      padding: spacing(12)
    }),
    kit.gap(),
    kit.columns('3', [
      feature('Faster', 'Describe the first benefit in a short sentence.'),
      feature('Simpler', 'Describe the second benefit in a short sentence.'),
      feature('Safer', 'Describe the third benefit in a short sentence.')
    ]),
    kit.gap(),
    kit.card([
      kit.title('Available today', { level: 2 }),
      kit.text(
        `${GREETING} the new feature is already live in your account. We would love to hear what you think: just reply to this email.`
      ),
      kit.button('Try it now', PLACEHOLDER_URL)
    ]),
    kit.footer(kind)
  ])
}

function promotion(kind: TemplateKind): TemplateContent {
  const kit = new EmailDesignKit(EMBER)
  const { palette } = kit

  return kit.document([
    kit.header(kind),
    kit.card(
      [
        kit.text(`<p style="text-align: center"><strong>Limited time</strong> · ends Sunday</p>`),
        kit.title('20% off everything', { align: 'center', padding: spacing(0, 0, 12, 0) }),
        kit.text(
          `<p style="text-align: center">${GREETING} our seasonal sale is on. Use the code below at checkout.</p>`
        )
      ],
      { padding: spacing(40, 32, 16, 32) }
    ),
    kit.card(
      [
        kit.title('SAVE20', {
          level: 2,
          align: 'center',
          color: palette.accent,
          padding: spacing(4, 0, 4, 0)
        }),
        kit.text('<p style="text-align: center">Your discount code</p>', {
          padding: spacing(0)
        })
      ],
      { background: palette.soft, padding: spacing(20, 32) }
    ),
    kit.card(
      [
        kit.button('Shop the sale', PLACEHOLDER_URL, { align: 'center', padding: spacing(8, 0) }),
        kit.image('Featured products', { padding: spacing(24, 0, 0, 0) })
      ],
      { padding: spacing(16, 32, 32, 32) }
    ),
    kit.gap(),
    kit.columns('2', [
      [kit.label('Free shipping'), kit.text('On every order during the sale.')],
      [kit.label('Easy returns'), kit.text('Changed your mind? Send it back within 30 days.')]
    ]),
    kit.footer(kind, { social: true })
  ])
}

function event(kind: TemplateKind): TemplateContent {
  const kit = new EmailDesignKit(VIOLET)

  return kit.document([
    kit.header(kind),
    kit.card([kit.image('Event banner', { padding: spacing(0) })], { padding: spacing(12) }),
    kit.gap(),
    kit.card([
      kit.text(kit.muted("You're invited")),
      kit.title('Join us for our community meetup'),
      kit.text(
        `${GREETING} we are getting together to share what we are working on, answer your questions and meet in person. We would love to see you there.`
      ),
      kit.facts([
        ['When', 'Thursday, 18 June · 6:00 PM'],
        ['Where', 'Your venue, street and city'],
        ['Price', 'Free · seats are limited']
      ]),
      kit.button('Reserve your seat', PLACEHOLDER_URL, { full: true })
    ]),
    kit.gap(),
    kit.card([
      kit.title('Agenda', { level: 2 }),
      kit.text(
        '<ul><li><strong>6:00 PM</strong> · Welcome and drinks</li><li><strong>6:30 PM</strong> · Talks and demos</li><li><strong>7:30 PM</strong> · Questions and networking</li></ul>'
      )
    ]),
    kit.footer(kind)
  ])
}

function welcome(kind: TemplateKind): TemplateContent {
  const kit = new EmailDesignKit(EMERALD)
  const { palette } = kit

  const step = (number: string, title: string, text: string) =>
    kit.columns(
      '1-3',
      [
        [
          kit.label(number, {
            size: 36,
            align: 'center',
            color: palette.accent,
            padding: spacing(0)
          })
        ],
        [kit.label(title, { padding: spacing(4, 0, 6, 0) }), kit.text(text)]
      ],
      { padding: spacing(8, 22) }
    )

  return kit.document([
    kit.header(kind),
    kit.card([
      kit.title('Welcome to {{ company.name }}! 👋'),
      kit.text(
        `${GREETING} thanks for joining us. We are glad you are here. Here is how to get the most out of your first week.`
      )
    ]),
    kit.gap(8),
    step(
      '1',
      'Complete your profile',
      'Tell us a little about yourself so we can tailor what we send.'
    ),
    step('2', 'Explore the essentials', 'Start with our most popular guides and resources.'),
    step(
      '3',
      'Say hello',
      'Questions or ideas? Reply to this email: a real person reads every message.'
    ),
    kit.gap(8),
    kit.card([
      kit.button('Get started', PLACEHOLDER_URL, { align: 'center' }),
      kit.text('<p style="text-align: center">See you soon,<br>The {{ company.name }} team</p>', {
        padding: spacing(16, 0, 0, 0)
      })
    ]),
    kit.footer(kind, { social: true })
  ])
}

// Transactional -----------------------------------------------------------------

function confirmEmail(kind: TemplateKind): TemplateContent {
  const kit = new EmailDesignKit(SLATE)

  return kit.document([
    kit.header(kind),
    kit.card([
      kit.title('Confirm your email address'),
      kit.text(
        `${GREETING} please confirm that {{ contact.email }} is your email address so we can finish setting up your account.`
      ),
      kit.button('Confirm my email', '{{ data.confirm_url }}'),
      kit.divider(spacing(24, 0, 16, 0)),
      kit.text(
        kit.muted(
          'This link expires in 24 hours. If you did not create an account, you can safely ignore this email.'
        )
      )
    ]),
    kit.footer(kind)
  ])
}

function passwordReset(kind: TemplateKind): TemplateContent {
  const kit = new EmailDesignKit(SLATE)

  return kit.document([
    kit.header(kind),
    kit.card([
      kit.title('Reset your password'),
      kit.text(
        `${GREETING} we received a request to reset the password of your {{ company.name }} account. Choose a new one with the button below.`
      ),
      kit.button('Choose a new password', '{{ data.reset_url }}'),
      kit.divider(spacing(24, 0, 16, 0)),
      kit.text(
        kit.muted(
          'This link expires in 60 minutes. If you did not ask to reset your password, ignore this email: your password stays the same.'
        )
      )
    ]),
    kit.footer(kind)
  ])
}

/**
 * The order lines. The Liquid loop sits in HTML comments: Liquid still runs it,
 * while the editor canvas, which renders this block as HTML, shows clean rows
 * instead of loop tags pushed above the table.
 */
const ITEM_ROWS = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:#334155">
  <tr>
    <th align="left" style="padding:0 0 10px;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:bold">Item</th>
    <th align="center" style="padding:0 0 10px;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:bold">Qty</th>
    <th align="right" style="padding:0 0 10px;border-bottom:1px solid #e2e8f0;color:#475569;font-weight:bold">Price</th>
  </tr>
  <!-- {% for item in data.items %} -->
  <tr>
    <td style="padding:12px 0;border-bottom:1px solid #e2e8f0">{{ item.name }}</td>
    <td align="center" style="padding:12px 0;border-bottom:1px solid #e2e8f0">{{ item.quantity }}</td>
    <td align="right" style="padding:12px 0;border-bottom:1px solid #e2e8f0">{{ item.price }}</td>
  </tr>
  <!-- {% else %} -->
  <tr>
    <td colspan="3" style="padding:12px 0;border-bottom:1px solid #e2e8f0;color:#475569">The items of the order appear here.</td>
  </tr>
  <!-- {% endfor %} -->
</table>`

function receipt(kind: TemplateKind): TemplateContent {
  const kit = new EmailDesignKit(TEAL)

  return kit.document([
    kit.header(kind),
    kit.card([
      kit.text(kit.muted('Order {{ data.order_id }}')),
      kit.title('Thanks for your order!'),
      kit.text(
        `${GREETING} we have received your order and are getting it ready. Here is your receipt.`
      ),
      kit.html(ITEM_ROWS, spacing(12, 0, 4, 0)),
      kit.facts([
        ['Subtotal', '{{ data.subtotal }}'],
        ['Shipping', '{{ data.shipping }}'],
        ['Total', '{{ data.total }}']
      ]),
      kit.button('View your order', '{{ data.order_url }}')
    ]),
    kit.gap(),
    kit.columns('2', [
      [kit.label('Shipping to'), kit.text('{{ data.shipping_address }}')],
      [kit.label('Need help?'), kit.text('Reply to this email and our team will get back to you.')]
    ]),
    kit.footer(kind)
  ])
}

function shipping(kind: TemplateKind): TemplateContent {
  const kit = new EmailDesignKit(TEAL)

  return kit.document([
    kit.header(kind),
    kit.card([
      kit.title('Your order is on its way 📦'),
      kit.text(
        `${GREETING} good news: your order has shipped and should arrive by {{ data.delivery_date }}.`
      ),
      kit.facts([
        ['Order', '{{ data.order_id }}'],
        ['Carrier', '{{ data.carrier }}'],
        ['Tracking number', '{{ data.tracking_number }}']
      ]),
      kit.button('Track your package', '{{ data.tracking_url }}')
    ]),
    kit.footer(kind)
  ])
}

function notification(kind: TemplateKind): TemplateContent {
  const kit = new EmailDesignKit(SLATE)

  return kit.document([
    kit.header(kind),
    kit.card([
      kit.title('You have a new update'),
      kit.text(`${GREETING} {{ data.message | default: "something changed in your account." }}`),
      kit.button('View details', '{{ data.action_url }}')
    ]),
    kit.footer(kind)
  ])
}

function blank(kind: TemplateKind): TemplateContent {
  // An empty canvas: the visual editor invites the author to drag in the first block.
  return new EmailDesignKit(kind === 'marketing' ? INK : SLATE).document([])
}

const STARTERS: readonly StarterDefinition[] = [
  {
    id: 'newsletter',
    kind: 'marketing',
    name: 'Newsletter',
    description: 'A monthly digest with a cover, two stories and a call to action.',
    subject: 'The latest from {{ company.name }}',
    preheader: 'What we shipped, what we learned and what is next.',
    build: newsletter
  },
  {
    id: 'announcement',
    kind: 'marketing',
    name: 'Product announcement',
    description: 'Launch a feature with a bold hero, a screenshot and three benefits.',
    subject: 'Meet our newest feature',
    preheader: 'Available today in your account.',
    build: announcement
  },
  {
    id: 'promotion',
    kind: 'marketing',
    name: 'Sale or promotion',
    description: 'A discount code front and centre, with one clear button to shop.',
    subject: '20% off everything, this week only',
    preheader: 'Use code SAVE20 at checkout. Ends Sunday.',
    build: promotion
  },
  {
    id: 'event',
    kind: 'marketing',
    name: 'Event invitation',
    description: 'Invite people with the date, place, agenda and an RSVP button.',
    subject: "You're invited: our community meetup",
    preheader: 'Thursday, 18 June · Seats are limited.',
    build: event
  },
  {
    id: 'welcome',
    kind: 'marketing',
    name: 'Welcome',
    description: 'Greet new subscribers and guide them through three first steps.',
    subject: 'Welcome to {{ company.name }}!',
    preheader: 'Here is how to get the most out of your first week.',
    build: welcome
  },
  {
    id: 'confirm-email',
    kind: 'transactional',
    name: 'Confirm email',
    description: 'Ask new users to confirm their address with one button.',
    subject: 'Confirm your email address',
    preheader: 'One click to finish setting up your account.',
    sampleData: { confirm_url: 'https://your-website.com/confirm' },
    build: confirmEmail
  },
  {
    id: 'password-reset',
    kind: 'transactional',
    name: 'Password reset',
    description: 'A secure reset link with a short expiry notice.',
    subject: 'Reset your password',
    preheader: 'The link expires in 60 minutes.',
    sampleData: { reset_url: 'https://your-website.com/reset' },
    build: passwordReset
  },
  {
    id: 'receipt',
    kind: 'transactional',
    name: 'Order receipt',
    description: 'Line items, totals and the shipping address of an order.',
    subject: 'Your receipt for order {{ data.order_id }}',
    preheader: 'Thanks for your order! Here are the details.',
    sampleData: {
      order_id: '#1042',
      items: [
        { name: 'Linen shirt', quantity: 1, price: '$48.00' },
        { name: 'Canvas tote', quantity: 2, price: '$24.00' }
      ],
      subtotal: '$72.00',
      shipping: '$5.00',
      total: '$77.00',
      shipping_address: 'Alex Morgan, 12 Rua Augusta, Lisbon',
      order_url: 'https://your-website.com/orders/1042'
    },
    build: receipt
  },
  {
    id: 'shipping',
    kind: 'transactional',
    name: 'Shipping update',
    description: 'Tell customers their order shipped, with tracking details.',
    subject: 'Your order {{ data.order_id }} has shipped',
    preheader: 'Track your package on its way to you.',
    sampleData: {
      order_id: '#1042',
      delivery_date: 'Friday, 19 June',
      carrier: 'UPS',
      tracking_number: '1Z999AA10123456784',
      tracking_url: 'https://your-website.com/track'
    },
    build: shipping
  },
  {
    id: 'notification',
    kind: 'transactional',
    name: 'Notification',
    description: 'A simple message with one action, for any account event.',
    subject: 'You have a new update',
    preheader: 'Something changed in your account.',
    sampleData: {
      message: 'your monthly report is ready',
      action_url: 'https://your-website.com/account'
    },
    build: notification
  },
  {
    id: 'blank',
    kind: null,
    name: 'Blank',
    description: 'An empty canvas: build your email block by block.',
    subject: '',
    preheader: '',
    build: blank
  }
]

const DEFAULT_STARTER: Record<TemplateKind, StarterDefinition['id']> = {
  marketing: 'newsletter',
  transactional: 'notification'
}

/** The starters a new template can be created from. */
export class StarterCatalog {
  all(kind?: TemplateKind): StarterDefinition[] {
    return STARTERS.filter((starter) => !kind || !starter.kind || starter.kind === kind)
  }

  /** `default` (the REST API's starter) is the general-purpose layout of the template's type. */
  resolve(id: TemplateStarter, kind: TemplateKind): StarterDefinition {
    const wanted = id === 'default' ? DEFAULT_STARTER[kind] : id
    const starter = STARTERS.find((candidate) => candidate.id === wanted)

    if (!starter) throw new Error(`Unknown template starter "${id}"`)

    if (starter.kind && starter.kind !== kind) {
      throw new ValidationError(`"${starter.name}" is not available for ${kind} templates`, {
        field: 'starter'
      })
    }

    return starter
  }
}
