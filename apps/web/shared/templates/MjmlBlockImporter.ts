import { convertMjmlTemplate } from '@templatical/import-mjml'
import { isHtml, isSection, isTable, isWrapper } from '@templatical/types'
import type { Block, TemplateContent } from '@templatical/types'
import { load } from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import { isComment, isTag, isText } from 'domhandler'
import type { AnyNode, Element, Text } from 'domhandler'

/** A Liquid logic tag: `{% for item in data.items %}`, `{%- if vip -%}`, `{% endfor %}`… */
const LIQUID_LOGIC = /\{%-?[\s\S]*?-?%\}/

const LIQUID_LOGIC_ALL = new RegExp(LIQUID_LOGIC.source, 'g')

const LOGIC_KEYWORD = /^\{%-?\s*(\w+)/

/** Where the converter turns `logic / element / logic` into a block's display condition. */
const PAIRING_CONTAINERS = 'mj-body, mj-body mj-wrapper, mj-body mj-column'

/** Elements that hold other elements; MJML drops the comments written between them. */
const CONTAINERS =
  'mj-body, mj-body mj-wrapper, mj-body mj-section, mj-body mj-column, mj-body mj-group, mj-body mj-hero'

/** Liquid a display condition can hold around one block, with its closing tag. */
const WRAPPABLE = new Map([
  ['if', 'endif'],
  ['unless', 'endunless'],
  ['for', 'endfor']
])

/** Conditions that may wrap several elements: each element gets its own copy. Loops may not. */
const SPLITTABLE = new Set(['if', 'unless'])

/** Liquid block tags, with the tag that closes them. */
const BLOCK_TAGS = new Map([
  ...WRAPPABLE,
  ['case', 'endcase'],
  ['capture', 'endcapture'],
  ['tablerow', 'endtablerow']
])

const CLOSING_TAGS = new Set(BLOCK_TAGS.values())

/** Tags that only make sense inside an open block. */
const BRANCH_TAGS = new Set(['else', 'elsif', 'when'])

/**
 * `mj-text` attributes the converter carries into the template settings. Read
 * from defaults here, they would be frozen into the block and grow a wrapper
 * on every round trip, so only an element's own value is kept.
 */
const SETTINGS_STYLE = new Set(['color', 'font-family', 'font-size'])

/** Elements MJML pads by default; the converter does not know MJML's built-in defaults. */
const PADDED_TAGS = ['mj-text', 'mj-button', 'mj-image', 'mj-divider', 'mj-social', 'mj-table']

const MJML_PADDING = '10px 25px'

const SIDES = ['top', 'right', 'bottom', 'left'] as const

/** `mj-text` attributes that become CSS on the HTML a text is kept as. */
const TEXT_STYLE = new Map([
  ['color', 'color'],
  ['font-family', 'font-family'],
  ['font-size', 'font-size'],
  ['font-style', 'font-style'],
  ['font-weight', 'font-weight'],
  ['line-height', 'line-height'],
  ['letter-spacing', 'letter-spacing'],
  ['align', 'text-align'],
  ['text-decoration', 'text-decoration'],
  ['text-transform', 'text-transform']
])

/** `mj-table` attributes that become CSS on the `<table>` it is kept as. */
const TABLE_STYLE = new Map([
  ['color', 'color'],
  ['font-family', 'font-family'],
  ['font-size', 'font-size'],
  ['line-height', 'line-height'],
  ['table-layout', 'table-layout']
])

/** Markup a `<strong>` cannot wrap. */
const BLOCK_CONTENT = /<(?:p|div|h[1-6]|ul|ol|li|table|blockquote)\b/i

const BOLD = /^(?:bold|bolder|[6-9]00)$/i

/** The converter's own parser settings, plus source positions for in-place edits. */
const PARSE_OPTIONS = {
  xml: { xmlMode: false, recognizeSelfClosing: true, withStartIndices: true, withEndIndices: true }
}

/** A container's children, as far as logic around them is concerned. */
type LogicUnit =
  | { kind: 'element'; element: Element }
  | { kind: 'logic'; tag: string; keyword: string; node: Text; offset: number }

/** What an MJML template became in the visual editor. */
export interface MjmlImport {
  content: TemplateContent
  /** Parts kept as HTML blocks: markup with no block equivalent, or holding Liquid logic. */
  keptAsHtml: number
  /** Parts that could not be converted at all. */
  dropped: number
  /** Liquid conditions or loops around whole parts of the email that the blocks cannot keep. */
  unsupportedLogic: number
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

function startOf(node: AnyNode): number {
  if (node.startIndex === null) throw new Error('The MJML parser gave no source position')

  return node.startIndex
}

/** Index just past the node's last character. */
function endOf(node: AnyNode): number {
  if (node.endIndex === null) throw new Error('The MJML parser gave no source position')

  return node.endIndex + 1
}

function countLogic(text: string): number {
  return text.match(LIQUID_LOGIC_ALL)?.length ?? 0
}

function keywordOf(tag: string): string {
  return LOGIC_KEYWORD.exec(tag.trim())?.[1]?.toLowerCase() ?? ''
}

/** Whether every Liquid block opened in the markup is also closed in it, in order. */
function isSelfContained(markup: string): boolean {
  const expected: string[] = []

  for (const [tag] of markup.matchAll(LIQUID_LOGIC_ALL)) {
    const keyword = keywordOf(tag)
    const closing = BLOCK_TAGS.get(keyword)

    if (closing) {
      expected.push(closing)
    } else if (BRANCH_TAGS.has(keyword)) {
      if (!expected.length) return false
    } else if (CLOSING_TAGS.has(keyword) && expected.pop() !== keyword) {
      return false
    }
  }

  return expected.length === 0
}

/** `<mj-attributes>` defaults, merged the way MJML and the converter merge them. */
class MjmlDefaults {
  private readonly all = new Map<string, string>()

  private readonly byTag = new Map<string, Map<string, string>>()

  constructor($: CheerioAPI) {
    for (const child of $('mj-attributes').children().toArray()) {
      if (child.tagName === 'mj-class') continue

      const target =
        child.tagName === 'mj-all' ? this.all : (this.byTag.get(child.tagName) ?? new Map())

      for (const [name, value] of Object.entries(child.attribs)) target.set(name, value)

      if (child.tagName !== 'mj-all') this.byTag.set(child.tagName, target)
    }
  }

  /** An element's attribute: its own, else its tag's default, else the default for every tag. */
  resolve(element: Element, name: string): string | undefined {
    return element.attribs[name] ?? this.byTag.get(element.tagName)?.get(name) ?? this.all.get(name)
  }

  /** Whether a default sets the attribute for this tag. */
  sets(tag: string, name: string): boolean {
    return this.all.has(name) || this.byTag.get(tag)?.has(name) === true
  }
}

/** Changes to the MJML source, applied by position so everything else stays byte for byte. */
class SourceEdits {
  private readonly edits: { start: number; end: number; text: string }[] = []

  constructor(private readonly source: string) {}

  replace(node: AnyNode, text: string): void {
    this.edits.push({ start: startOf(node), end: endOf(node), text })
  }

  insert(at: number, text: string): void {
    this.edits.push({ start: at, end: at, text })
  }

  apply(): string {
    return this.edits
      .toSorted((a, b) => b.start - a.start || b.end - a.end)
      .reduce(
        (source, edit) => source.slice(0, edit.start) + edit.text + source.slice(edit.end),
        this.source
      )
  }
}

/**
 * Prepares MJML for the converter, which rebuilds each element from its
 * visible structure and reads none of MJML's built-in defaults:
 *
 * - text and tables holding Liquid logic, or markup a table block cannot hold,
 *   become HTML blocks that keep their styling;
 * - Liquid logic around whole elements becomes `mj-raw` tags the converter
 *   turns into display conditions, one per element for `if` and `unless`;
 * - MJML's default element padding and bold text weight are written out.
 */
class MjmlPreparation {
  private readonly $: CheerioAPI

  private readonly defaults: MjmlDefaults

  private readonly edits: SourceEdits

  /** Elements turned into HTML blocks. */
  guarded = 0

  /** Logic tags written in addition to the source's own (closing and reopening a split condition). */
  addedLogic = 0

  constructor(private readonly source: string) {
    this.$ = load(source, PARSE_OPTIONS)
    this.defaults = new MjmlDefaults(this.$)
    this.edits = new SourceEdits(source)
  }

  /** Logic tags written in the body, except in comments between elements, which MJML drops. */
  bodyLogic(): number {
    const body = this.$('mj-body').get(0)

    if (!body) return 0

    const dead = this.$(CONTAINERS)
      .toArray()
      .flatMap((container) => container.children.filter(isComment))
      .reduce((sum, comment) => sum + countLogic(comment.data), 0)

    return countLogic(this.source.slice(startOf(body), endOf(body))) - dead
  }

  run(): string {
    this.restorePadding()

    for (const text of this.$('mj-body mj-text').toArray()) this.prepareText(text)

    for (const table of this.$('mj-body mj-table').toArray()) this.prepareTable(table)

    for (const container of this.$(PAIRING_CONTAINERS).toArray()) this.prepareLogic(container)

    return this.edits.apply()
  }

  private inner(element: Element): string {
    const first = element.children.at(0)
    const last = element.children.at(-1)

    return first && last ? this.source.slice(startOf(first), endOf(last)) : ''
  }

  private hasMarkupCells(element: Element): boolean {
    return this.$(element)
      .find('td, th')
      .toArray()
      .some((cell) => this.$(cell).children().length > 0)
  }

  private prepareText(element: Element): void {
    const inner = this.inner(element)
    const roots = this.$(element).children()
    const markupTable = roots.length === 1 && roots.is('table') && this.hasMarkupCells(element)

    if (LIQUID_LOGIC.test(inner) || markupTable) {
      const style = this.css(element, TEXT_STYLE)
      this.keepAsHtml(
        element,
        style ? `<div style="${escapeAttribute(style)}">${inner}</div>` : inner
      )

      return
    }

    const weight = this.defaults.resolve(element, 'font-weight') ?? ''

    if (inner.trim() && BOLD.test(weight.trim()) && !BLOCK_CONTENT.test(inner)) {
      const [first, last] = [element.children.at(0), element.children.at(-1)]

      if (!first || !last) return
      this.edits.insert(startOf(first), '<strong>')
      this.edits.insert(endOf(last), '</strong>')
    }
  }

  private prepareTable(element: Element): void {
    const inner = this.inner(element)

    if (!LIQUID_LOGIC.test(inner) && !this.hasMarkupCells(element)) return

    const width = this.defaults.resolve(element, 'width') ?? '100%'
    const cellpadding = this.defaults.resolve(element, 'cellpadding') ?? '0'
    const cellspacing = this.defaults.resolve(element, 'cellspacing') ?? '0'

    const style = [this.css(element, TABLE_STYLE), 'border-collapse:collapse']
      .filter(Boolean)
      .join(';')

    this.keepAsHtml(
      element,
      `<table role="presentation" width="${escapeAttribute(width)}" cellpadding="${escapeAttribute(cellpadding)}" cellspacing="${escapeAttribute(cellspacing)}" style="${escapeAttribute(style)}">${inner}</table>`
    )
  }

  /** Replaces the element with an `mj-raw`, which the converter keeps as an HTML block. */
  private keepAsHtml(element: Element, html: string): void {
    const background = element.attribs['container-background-color']

    const attributes = [
      `padding="${escapeAttribute(this.padding(element))}"`,
      background ? `container-background-color="${escapeAttribute(background)}"` : '',
      element.attribs['css-class']
        ? `css-class="${escapeAttribute(element.attribs['css-class'])}"`
        : ''
    ]

    this.edits.replace(element, `<mj-raw ${attributes.filter(Boolean).join(' ')}>${html}</mj-raw>`)
    this.guarded++
  }

  /** The element's padding as a four-value shorthand, with MJML's default when none is set. */
  private padding(element: Element): string {
    const shorthand = (this.defaults.resolve(element, 'padding') ?? MJML_PADDING)
      .trim()
      .split(/\s+/)

    const [top = '0', right = top, bottom = top, left = right] = shorthand

    const box = new Map([
      ['top', top],
      ['right', right],
      ['bottom', bottom],
      ['left', left]
    ])

    for (const side of SIDES) {
      const own = this.defaults.resolve(element, `padding-${side}`)

      if (own) box.set(side, own)
    }

    return SIDES.map((side) => box.get(side)).join(' ')
  }

  private css(element: Element, properties: ReadonlyMap<string, string>): string {
    return [...properties]
      .flatMap(([attribute, property]) => {
        const value = SETTINGS_STYLE.has(attribute)
          ? element.attribs[attribute]
          : this.defaults.resolve(element, attribute)

        return value ? [`${property}:${value}`] : []
      })
      .join(';')
  }

  /**
   * Wraps balanced logic written around elements (`{% if %}…{% endif %}`,
   * `{% for %}` around one element) in `mj-raw`, so the converter makes it a
   * display condition, and gives each element of a multi-element `if` /
   * `unless` its own copy. Anything else (`else`, nesting, a loop around
   * several elements) is left out, and counted as logic the blocks cannot keep.
   */
  private prepareLogic(container: Element): void {
    const units: LogicUnit[] = []

    for (const node of container.children) {
      if (isTag(node)) {
        units.push({ kind: 'element', element: node })
        continue
      }

      if (!isText(node) || !LIQUID_LOGIC.test(node.data)) continue

      const raw = this.source.slice(startOf(node), endOf(node))

      for (const match of raw.matchAll(LIQUID_LOGIC_ALL)) {
        units.push({
          kind: 'logic',
          tag: match[0],
          keyword: keywordOf(match[0]),
          node,
          offset: match.index
        })
      }
    }

    const wrapped = new Set<LogicUnit>()

    for (let index = 0; index < units.length; index++) {
      const open = units[index]

      if (open?.kind !== 'logic') continue

      const elements: Element[] = []
      let next = index + 1

      for (let unit = units[next]; unit?.kind === 'element'; unit = units[++next]) {
        elements.push(unit.element)
      }

      const end = units[next]

      const balanced =
        end?.kind === 'logic' &&
        WRAPPABLE.get(open.keyword) === end.keyword &&
        elements.length > 0 &&
        (elements.length === 1 || SPLITTABLE.has(open.keyword)) &&
        !elements.some((element) => element.tagName === 'mj-raw')

      if (!balanced) continue

      wrapped.add(open).add(end)

      for (const element of elements.slice(0, -1)) {
        this.edits.insert(
          endOf(element),
          `<mj-raw>{% ${end.keyword} %}</mj-raw><mj-raw>${open.tag}</mj-raw>`
        )
        this.addedLogic += 2
      }

      index = next
    }

    for (const node of new Set(
      [...wrapped].flatMap((unit) => (unit.kind === 'logic' ? [unit.node] : []))
    )) {
      const offsets = new Set(
        [...wrapped].flatMap((unit) =>
          unit.kind === 'logic' && unit.node === node ? [unit.offset] : []
        )
      )

      const raw = this.source.slice(startOf(node), endOf(node))

      this.edits.replace(
        node,
        raw.replace(LIQUID_LOGIC_ALL, (tag: string, offset: number) =>
          offsets.has(offset) ? `<mj-raw>${tag}</mj-raw>` : tag
        )
      )
    }
  }

  /** Writes MJML's default element padding into `<mj-attributes>` where the source sets none. */
  private restorePadding(): void {
    const missing = PADDED_TAGS.filter((tag) => !this.defaults.sets(tag, 'padding'))
    const body = this.$('mj-body').get(0)

    if (!missing.length || !body) return

    const defaults = missing.map((tag) => `<${tag} padding="${MJML_PADDING}" />`).join('')
    const attributes = this.$('mj-head mj-attributes').get(0)
    const head = this.$('mj-head').get(0)

    if (attributes) {
      this.insertInto(attributes, defaults)
    } else if (head) {
      this.insertInto(head, `<mj-attributes>${defaults}</mj-attributes>`)
    } else {
      this.edits.insert(
        startOf(body),
        `<mj-head><mj-attributes>${defaults}</mj-attributes></mj-head>`
      )
    }
  }

  /** Puts markup first inside an element (before the element's own defaults, which then win). */
  private insertInto(element: Element, markup: string): void {
    const first = element.children.at(0)

    if (first) {
      this.edits.insert(startOf(first), markup)

      return
    }

    this.edits.replace(element, `<${element.tagName}>${markup}</${element.tagName}>`)
  }
}

/**
 * Turns MJML (a code template, or one saved by the previous editor) into an
 * editor document, keeping what the visual editor can keep and counting what
 * it cannot, so people are told before anything is lost.
 */
export class MjmlBlockImporter {
  import(mjml: string): MjmlImport {
    const preparation = new MjmlPreparation(mjml)
    const prepared = preparation.run()
    const { content, report } = convertMjmlTemplate(prepared)
    const blocks = [...this.walk(content.blocks)]

    this.decodeTableCells(blocks)

    return {
      content,
      keptAsHtml: report.summary.htmlFallback + preparation.guarded,
      dropped: report.summary.skipped,
      unsupportedLogic: this.unsupportedLogic(
        preparation.bodyLogic() + preparation.addedLogic,
        content,
        blocks
      )
    }
  }

  private *walk(blocks: Block[]): Generator<Block> {
    for (const block of blocks) {
      yield block

      if (isSection(block)) for (const column of block.children) yield* this.walk(column)

      if (isWrapper(block)) yield* this.walk(block.children)
    }
  }

  /**
   * Table blocks hold plain text, but the converter stores each cell as HTML,
   * so "Shipping &amp; handling" would be encoded twice and Liquid quotes would break.
   */
  private decodeTableCells(blocks: Block[]): void {
    for (const block of blocks) {
      if (!isTable(block)) continue

      for (const row of block.rows) {
        for (const cell of row.cells) cell.content = load(cell.content, null, false).root().text()
      }
    }
  }

  /**
   * Logic that will not work in the visual editor: tags the document lost, and
   * tags in an HTML block or a display condition whose opening or closing tag
   * is in another block (deleting or moving one block breaks the email).
   */
  private unsupportedLogic(expected: number, content: TemplateContent, blocks: Block[]): number {
    // A display condition's label repeats its opening tag; it is not part of the email.
    const labels = blocks.reduce(
      (sum, block) => sum + countLogic(block.displayCondition?.label ?? ''),
      0
    )

    const kept = countLogic(JSON.stringify(content)) - labels

    const split = blocks.reduce((sum, block) => {
      const condition = block.displayCondition

      const parts = [
        isHtml(block) ? block.content : '',
        condition ? condition.before + condition.after : ''
      ]

      return (
        sum +
        parts.reduce((count, part) => (isSelfContained(part) ? count : count + countLogic(part)), 0)
      )
    }, 0)

    return Math.max(0, expected - kept) + split
  }
}
