import {
  createButtonBlock,
  createDividerBlock,
  createHtmlBlock,
  createImageBlock,
  createParagraphBlock,
  createSectionBlock,
  createSocialIconsBlock,
  createSpacerBlock,
  createTableBlock,
  createTitleBlock,
  generateId
} from '@templatical/types'
import type {
  Block,
  ButtonBlock,
  ColumnLayout,
  HeadingLevel,
  ImageBlock,
  SectionBlock,
  SocialPlatform,
  SpacingValue,
  TemplateContent,
  TemplateSettings,
  TitleBlock
} from '@templatical/types'
import type { TemplateKind } from '../types/domain'

/** Colours of one starter. Every text/background pair passes WCAG AA (4.5:1). */
export interface StarterPalette {
  /** Behind the cards. */
  page: string
  card: string
  heading: string
  text: string
  /** Secondary text on `page` (footer, captions). */
  muted: string
  /** Buttons, links and highlights. */
  accent: string
  /** Text on `accent`. */
  onAccent: string
  /** Tinted panels (codes, summaries). */
  soft: string
  /** Dividers and table borders. */
  line: string
}

export interface CardOptions {
  background?: string
  padding?: SpacingValue
  /** Space below the card, before the next one. */
  gap?: number
}

export interface TextOptions {
  align?: 'left' | 'center' | 'right'
  padding?: SpacingValue
}

export interface TitleOptions extends TextOptions {
  level?: HeadingLevel
  color?: string
}

export interface LabelOptions extends TextOptions {
  color?: string
  /** Font size in px. */
  size?: number
}

export interface ButtonOptions {
  align?: 'left' | 'center' | 'right'
  full?: boolean
  background?: string
  color?: string
  padding?: SpacingValue
}

/** Sample link authors replace: obviously a placeholder, still a valid URL. */
export const PLACEHOLDER_URL = 'https://your-website.com'

const CARD_RADIUS = 12

/** Home pages the sample social icons link to, until the author enters their own profiles. */
const SOCIAL_HOME = new Map<SocialPlatform, string>([
  ['instagram', 'https://instagram.com/'],
  ['linkedin', 'https://linkedin.com/'],
  ['youtube', 'https://youtube.com/'],
  ['facebook', 'https://facebook.com/'],
  ['twitter', 'https://x.com/']
])

/** A link written without scheme, `www.` or trailing slash, to compare addresses. */
function bareUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(?:www\.)?/, '')
    .replace(/\/+$/, '')
}

const SAMPLE_SOCIAL = new Set([...SOCIAL_HOME.values()].map(bareUrl))

/** Whether a social icon still links to a network's home page, as the starters do. */
export function isSampleSocialUrl(url: string): boolean {
  return SAMPLE_SOCIAL.has(bareUrl(url))
}

export function spacing(top: number, right = top, bottom = top, left = right): SpacingValue {
  return { top, right, bottom, left }
}

/**
 * Builds visual-editor documents (Templatical JSON) from a palette, so every
 * starter shares the same proportions: a 600px column of rounded white cards
 * on a tinted page, comfortable padding, AA-contrast colours and a footer that
 * carries what the email type requires (unsubscribe for marketing).
 */
export class EmailDesignKit {
  constructor(
    readonly palette: StarterPalette,
    private readonly fontFamily = 'Helvetica'
  ) {}

  /** A kit matching an existing document, for blocks added to it later (a missing footer). */
  static matching(settings: TemplateSettings): EmailDesignKit {
    const text = settings.textColor

    return new EmailDesignKit(
      {
        page: settings.backgroundColor,
        card: '#ffffff',
        heading: text,
        text,
        muted: text,
        accent: settings.linkColor ?? text,
        onAccent: '#ffffff',
        soft: settings.backgroundColor,
        line: '#e4e4e7'
      },
      settings.fontFamily
    )
  }

  document(blocks: Block[]): TemplateContent {
    return {
      blocks,
      settings: {
        width: 600,
        backgroundColor: this.palette.page,
        textColor: this.palette.text,
        linkColor: this.palette.accent,
        linkUnderline: true,
        fontFamily: this.fontFamily,
        locale: 'en'
      }
    }
  }

  // Layout -------------------------------------------------------------------

  /** A rounded content card: one column of blocks. */
  card(children: Block[], options: CardOptions = {}): SectionBlock {
    return createSectionBlock({
      columns: '1',
      children: [children],
      borderRadius: CARD_RADIUS,
      styles: {
        padding: options.padding ?? spacing(32, 32, 32, 32),
        backgroundColor: options.background ?? this.palette.card
      }
    })
  }

  /** Side-by-side columns inside a card (they stack on phones). */
  columns(layout: ColumnLayout, children: Block[][], options: CardOptions = {}): SectionBlock {
    return createSectionBlock({
      columns: layout,
      children,
      stackOnMobile: true,
      borderRadius: CARD_RADIUS,
      styles: {
        padding: options.padding ?? spacing(16, 22),
        backgroundColor: options.background ?? this.palette.card
      }
    })
  }

  /** Empty space between cards. */
  gap(height = 16): SectionBlock {
    return createSectionBlock({
      columns: '1',
      children: [[createSpacerBlock({ height, styles: { padding: spacing(0) } })]],
      styles: { padding: spacing(0) }
    })
  }

  /** Company name, plus a "View in browser" link for marketing email. */
  header(kind: TemplateKind): SectionBlock {
    const name = this.label('{{ company.name }}', { size: 18, padding: spacing(0, 10) })

    if (kind === 'transactional') {
      return createSectionBlock({
        columns: '1',
        children: [[name]],
        styles: { padding: spacing(32, 22, 16, 22) }
      })
    }

    return createSectionBlock({
      columns: '2',
      children: [
        [name],
        [
          this.text(this.muted('<a href="{{ web_url }}">View in browser</a>'), {
            align: 'right',
            padding: spacing(2, 10, 0, 10)
          })
        ]
      ],
      stackOnMobile: false,
      styles: { padding: spacing(32, 22, 16, 22) }
    })
  }

  /**
   * Who sent it and why. Marketing email adds the preference and one-click
   * unsubscribe links the law and mailbox providers require.
   */
  footer(kind: TemplateKind, options: { social?: boolean } = {}): SectionBlock {
    const lines =
      kind === 'marketing'
        ? [
            'You are receiving this email because you subscribed to updates from {{ company.name }}.',
            '{{ company.address }}',
            '<a href="{{ preferences_url }}">Manage preferences</a> · <a href="{{ unsubscribe_url }}">Unsubscribe</a>'
          ]
        : [
            'This email was sent to {{ contact.email }} by {{ company.name }}.',
            '{{ company.address }}'
          ]

    const children: Block[] = []

    if (options.social) children.push(this.social(['instagram', 'linkedin', 'youtube']))

    children.push(
      this.text(lines.map((line) => this.muted(line)).join(''), {
        align: 'center',
        padding: spacing(8, 10)
      })
    )

    return createSectionBlock({
      columns: '1',
      children: [children],
      styles: { padding: spacing(24, 22, 40, 22) }
    })
  }

  /** A small, centred unsubscribe link, for a footer that lost its own. */
  unsubscribeLine(): SectionBlock {
    return createSectionBlock({
      columns: '1',
      children: [
        [
          this.text(this.muted('<a href="{{ unsubscribe_url }}">Unsubscribe</a>'), {
            align: 'center',
            padding: spacing(8, 10)
          })
        ]
      ],
      styles: { padding: spacing(0, 22, 24, 22) }
    })
  }

  /** A paragraph in the secondary text colour. */
  muted(html: string): string {
    return `<p><span style="color: ${this.palette.muted}">${html}</span></p>`
  }

  // Content ------------------------------------------------------------------

  title(content: string, options: TitleOptions = {}): TitleBlock {
    return createTitleBlock({
      content,
      level: options.level ?? 1,
      color: options.color ?? this.palette.heading,
      textAlign: options.align ?? 'left',
      styles: { padding: options.padding ?? spacing(0, 0, 12, 0) }
    })
  }

  /**
   * Bold text that introduces a column or names the sender. It is a paragraph,
   * not a heading, so every email keeps a single H1 and an unbroken heading
   * outline for screen readers.
   */
  label(content: string, options: LabelOptions = {}): Block {
    const color = options.color ?? this.palette.heading
    const size = options.size ?? 17

    return this.text(
      `<p><strong><span style="color: ${color}; font-size: ${size}px">${content}</span></strong></p>`,
      { align: options.align, padding: options.padding ?? spacing(0, 0, 6, 0) }
    )
  }

  /** Rich text. Plain sentences become one paragraph; HTML (`<p>…`) is kept as written. */
  text(content: string, options: TextOptions = {}): Block {
    const html = content.trimStart().startsWith('<') ? content : `<p>${content}</p>`

    const aligned =
      options.align && options.align !== 'left'
        ? html.replaceAll('<p>', `<p style="text-align: ${options.align}">`)
        : html

    return createParagraphBlock({
      content: aligned,
      paragraphSpacing: 12,
      styles: { padding: options.padding ?? spacing(0, 0, 12, 0) }
    })
  }

  button(text: string, url: string, options: ButtonOptions = {}): ButtonBlock {
    return createButtonBlock({
      text,
      url,
      align: options.align ?? 'left',
      width: options.full ? 'full' : undefined,
      backgroundColor: options.background ?? this.palette.accent,
      textColor: options.color ?? this.palette.onAccent,
      borderRadius: 8,
      fontSize: 15,
      fontWeight: 'bold',
      buttonPadding: spacing(14, 28),
      styles: { padding: options.padding ?? spacing(12, 0, 4, 0) }
    })
  }

  /**
   * An image slot to fill in: the editor shows a drop zone, and an image with
   * no picture is left out of the email until one is chosen.
   */
  image(alt: string, options: { padding?: SpacingValue; radius?: number } = {}): ImageBlock {
    return createImageBlock({
      src: '',
      alt,
      width: 'full',
      align: 'center',
      borderRadius: options.radius ?? 8,
      styles: { padding: options.padding ?? spacing(0, 0, 16, 0) }
    })
  }

  divider(padding = spacing(16, 0)): Block {
    return createDividerBlock({
      color: this.palette.line,
      thickness: 1,
      lineStyle: 'solid',
      width: 'full',
      styles: { padding }
    })
  }

  /** Label/value rows (order details, event facts). Table cells hold plain text. */
  facts(rows: [string, string][], options: { padding?: SpacingValue } = {}): Block {
    return createTableBlock({
      hasHeaderRow: false,
      borderColor: this.palette.line,
      borderWidth: 1,
      cellPadding: 12,
      fontSize: 14,
      color: this.palette.text,
      textAlign: 'left',
      rows: rows.map(([label, value]) => ({
        id: generateId(),
        cells: [
          { id: generateId(), content: label },
          { id: generateId(), content: value }
        ]
      })),
      styles: { padding: options.padding ?? spacing(8, 0, 16, 0) }
    })
  }

  /** Raw HTML, for content blocks cannot express (Liquid loops over API data). */
  html(content: string, padding = spacing(0, 0, 12, 0)): Block {
    return createHtmlBlock({ content, styles: { padding } })
  }

  social(platforms: SocialPlatform[]): Block {
    return createSocialIconsBlock({
      icons: platforms.map((platform) => ({
        id: generateId(),
        platform,
        url: SOCIAL_HOME.get(platform) ?? PLACEHOLDER_URL
      })),
      iconStyle: 'circle',
      iconTone: 'dark',
      iconSize: 'small',
      spacing: 12,
      align: 'center',
      styles: { padding: spacing(0, 0, 12, 0) }
    })
  }
}
