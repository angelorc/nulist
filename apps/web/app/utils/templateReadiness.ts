import { isSection, isSocialIcons, isWrapper } from '@templatical/types'
import type { Block, TemplateContent } from '@templatical/types'
import type { TemplateKind } from '#shared/types/domain'
import { PLACEHOLDER_URL, isSampleSocialUrl } from '#shared/templates/EmailDesignKit'

/** Something to look at before sending, in plain language. */
export interface ReadinessItem {
  id: 'unsubscribe' | 'sample-links' | 'sample-social' | 'empty-images'
  /** `problem` must be fixed before a campaign goes out; `tip` improves the email. */
  level: 'problem' | 'tip'
  title: string
  description: string
  /** A one-click fix the editor offers. */
  fix?: ReadinessFix
}

/** One-click fixes: a whole footer, or just the link a footer is missing. */
export type ReadinessFix = 'add-footer' | 'add-unsubscribe-link'

/** The same rule the send checks apply: either link lets people opt out in one click. */
const OPT_OUT_LINK = /\{\{\s*(?:unsubscribe_url|preferences_url)\b/

/** The postal address, or the usual footer wording: the email already has a footer. */
const FOOTER = /\{\{\s*company\.address\b|You are receiving this email|This email was sent to/i

const SAMPLE_LINK = new RegExp(
  `^(?:${PLACEHOLDER_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|https?://(?:www\\.)?example\\.(?:com|org|net))`,
  'i'
)

/** Hidden on desktop and on mobile: nobody sees it. */
function isHiddenEverywhere(block: Block): boolean {
  return block.visibility?.desktop === false && block.visibility.mobile === false
}

/** The blocks people see, nested as in the document. */
function visibleBlocks(blocks: readonly Block[]): Block[] {
  return blocks.flatMap((block): Block[] => {
    if (isHiddenEverywhere(block)) return []

    if (isSection(block)) return [{ ...block, children: block.children.map(visibleBlocks) }]

    if (isWrapper(block)) return [{ ...block, children: visibleBlocks(block.children) }]

    return [block]
  })
}

/** Every block of a document, the blocks inside sections and wrappers included. */
function blocksOf(blocks: readonly Block[]): Block[] {
  return blocks.flatMap((block) => {
    if (isSection(block)) return [block, ...blocksOf(block.children.flat())]

    if (isWrapper(block)) return [block, ...blocksOf(block.children)]

    return [block]
  })
}

/** Link targets written in rich text (`href="…"`). */
function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '')
}

/**
 * The checks people forget before sending, computed from the editor document:
 * the unsubscribe link marketing email must carry, sample links left from a
 * starter, and image slots never filled. The editor's own Issues tab covers
 * accessibility and email-client support.
 */
export class TemplateReadiness {
  constructor(private readonly kind: TemplateKind) {}

  check(content: TemplateContent): ReadinessItem[] {
    const items: ReadinessItem[] = []
    const visible = visibleBlocks(content.blocks)
    const blocks = blocksOf(visible)
    const links: string[] = []
    let emptyImages = 0
    let sampleSocial = 0

    for (const block of blocks) {
      if (block.type === 'button' && 'url' in block) links.push(block.url)

      if (block.type === 'image' && 'src' in block) {
        if (!block.src) emptyImages++

        if (block.linkUrl) links.push(block.linkUrl)
      }

      if ((block.type === 'paragraph' || block.type === 'title') && 'content' in block) {
        links.push(...hrefsOf(block.content))
      }

      if (block.type === 'menu' && 'items' in block) links.push(...block.items.map((i) => i.url))

      if (isSocialIcons(block)) {
        sampleSocial += block.icons.filter((icon) => isSampleSocialUrl(icon.url)).length
      }
    }

    const everything = JSON.stringify(visible)

    if (this.kind === 'marketing' && !OPT_OUT_LINK.test(everything)) {
      const hasFooter = FOOTER.test(everything)

      items.push({
        id: 'unsubscribe',
        level: 'problem',
        title: 'Add an unsubscribe link',
        description: hasFooter
          ? 'Marketing email must let people unsubscribe in one click, and your footer has no unsubscribe link. Add it here, or select a word such as "Unsubscribe", click Link and choose the "Unsubscribe link" variable as the address.'
          : 'Marketing email must let people unsubscribe in one click. Add the footer, or select a word such as "Unsubscribe", click Link and choose the "Unsubscribe link" variable as the address.',
        fix: hasFooter ? 'add-unsubscribe-link' : 'add-footer'
      })
    }

    const samples = links.filter((link) => SAMPLE_LINK.test(link.trim())).length

    if (samples) {
      items.push({
        id: 'sample-links',
        level: 'problem',
        title: `${samples} ${samples === 1 ? 'link still points' : 'links still point'} to the sample website`,
        description: `Select each button or link that goes to ${PLACEHOLDER_URL.replace('https://', '')} and enter your own address.`
      })
    }

    if (sampleSocial) {
      items.push({
        id: 'sample-social',
        level: 'problem',
        title: `${sampleSocial} social ${sampleSocial === 1 ? 'icon still links' : 'icons still link'} to the network's home page`,
        description:
          'Select the social icons and enter the address of your own profile for each network, or remove the networks you are not on.'
      })
    }

    if (emptyImages) {
      items.push({
        id: 'empty-images',
        level: 'tip',
        title: `${emptyImages} ${emptyImages === 1 ? 'image has' : 'images have'} no picture yet`,
        description:
          'Click an empty image to choose a picture, or delete it. Empty images are left out of the email.'
      })
    }

    return items
  }
}
