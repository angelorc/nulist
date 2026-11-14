import { htmlLanguage } from '@codemirror/lang-html'
import { javascriptLanguage, typescriptLanguage } from '@codemirror/lang-javascript'
import { jsonLanguage } from '@codemirror/lang-json'
import { type Language, StreamLanguage } from '@codemirror/language'
import { python } from '@codemirror/legacy-modes/mode/python'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { classHighlighter, highlightCode } from '@lezer/highlight'
import { z } from 'zod'

export const CODE_LANGUAGES = [
  'json',
  'javascript',
  'typescript',
  'html',
  'shell',
  'python',
  'text'
] as const

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]

/** A run of text with the `tok-*` classes of its syntax role ('' for plain text). */
export interface CodeToken {
  text: string
  className: string
}

/** One source line; `indent` counts its leading whitespace, for a hanging indent when wrapped. */
export class CodeLine {
  readonly tokens: CodeToken[] = []

  get indent(): number {
    const text = this.tokens.map((token) => token.text).join('')

    return text.length - text.trimStart().length
  }

  static plain(text: string): CodeLine {
    const line = new CodeLine()

    if (text) line.tokens.push({ text, className: '' })

    return line
  }
}

/**
 * Splits code into lines of highlighted tokens with the CodeMirror parsers, without an editor.
 * Inputs longer than `maxLength` are split into plain lines, unparsed, so huge payloads stay cheap.
 *
 * ```ts
 * const lines = new CodeHighlighter().lines('{"a": 1}', 'json')
 * ```
 */
export class CodeHighlighter {
  private static readonly languages: Readonly<Record<Exclude<CodeLanguage, 'text'>, Language>> = {
    json: jsonLanguage,
    javascript: javascriptLanguage,
    typescript: typescriptLanguage,
    html: htmlLanguage,
    shell: StreamLanguage.define(shell),
    python: StreamLanguage.define(python)
  }

  constructor(readonly maxLength = 200_000) {}

  lines(code: string, lang: CodeLanguage): CodeLine[] {
    const source = code.endsWith('\n') ? code.slice(0, -1) : code

    if (code.length > this.maxLength || lang === 'text') {
      return source.split('\n').map((text) => CodeLine.plain(text))
    }

    const lines = [new CodeLine()]
    const parser = CodeHighlighter.languages[lang].parser

    highlightCode(
      source,
      parser.parse(source),
      classHighlighter,
      (text, className) => lines.at(-1)?.tokens.push({ text, className }),
      () => lines.push(new CodeLine())
    )

    return lines
  }
}

export const jsonValueSchema = z.json()

export type JsonValue = z.infer<typeof jsonValueSchema>

export interface FormattedJson {
  code: string
  lang: Extract<CodeLanguage, 'json' | 'text'>
}

/**
 * Pretty-prints JSON. Strings that hold a JSON object or array (an SNS `Message`, a stringified
 * response body) are parsed and shown nested, at any depth; other strings stay plain text.
 *
 * ```ts
 * new JsonFormatter().format({ Message: '{"eventType":"Bounce"}' })
 * ```
 */
export class JsonFormatter {
  private static readonly embedded = z
    .string()
    .trim()
    .regex(/^[[{]/)
    .transform((text, ctx) => {
      try {
        return JSON.parse(text)
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Not JSON' })

        return z.NEVER
      }
    })
    .pipe(z.union([z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]))

  constructor(readonly indent = 2) {}

  format(value: JsonValue): FormattedJson {
    const root = this.expand(value)
    const plain = z.string().safeParse(root)

    if (plain.success) return { code: plain.data, lang: 'text' }

    return {
      code: JSON.stringify(root, (_key, nested: JsonValue) => this.expand(nested), this.indent),
      lang: 'json'
    }
  }

  private expand(value: JsonValue): JsonValue {
    const embedded = JsonFormatter.embedded.safeParse(value)

    return embedded.success ? embedded.data : value
  }
}
