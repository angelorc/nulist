import type {
  CompanyVariables,
  ContactVariables,
  PreparedEmail,
  RenderedEmail,
  RenderVariables,
  TemplateRenderer
} from '../templates/TemplateRenderer'

export type OptInEmailKind = 'confirmation' | 'reminder'

/** The list a confirmation is about (`{{ list.name }}`, `{{ list.description }}`). */
export type OptInListVariables = {
  name: string
  description: string | null
}

export interface OptInEmailInput {
  kind: OptInEmailKind
  contact: ContactVariables
  list: OptInListVariables
  company: CompanyVariables
  confirmUrl: string
  expiresInDays: number
}

/** Liquid variables of the opt-in email (HTML output is escaped by the renderer). */
interface OptInVariables extends RenderVariables {
  reminder: boolean
  contact: ContactVariables
  list: OptInListVariables
  company: CompanyVariables
  confirm_url: string
  expires_in: string
}

const SUBJECTS: Record<OptInEmailKind, string> = {
  confirmation: 'Confirm your subscription to {{ list.name }}',
  reminder: 'Reminder: confirm your subscription to {{ list.name }}'
}

const PREHEADERS: Record<OptInEmailKind, string> = {
  confirmation: 'One click and you are in. Ignore this email if you did not sign up.',
  reminder: 'Your confirmation link expires in {{ expires_in }}.'
}

/** Clean, brand-neutral confirmation email. Compiled from MJML once per process. */
const OPT_IN_MJML = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Geist, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" />
      <mj-text font-size="15px" line-height="24px" color="#404040" padding="0 0 16px" />
      <mj-button background-color="#171717" color="#ffffff" font-size="15px" font-weight="500" border-radius="6px" inner-padding="12px 24px" padding="8px 0 24px" />
    </mj-attributes>
    <mj-style>
      a { color: #2563eb; }
      .break { word-break: break-all; }
    </mj-style>
  </mj-head>
  <mj-body background-color="#f5f5f5" width="560px">
    <mj-section padding="32px 0 12px">
      <mj-column>
        <mj-text font-size="14px" font-weight="600" color="#171717" padding="0 24px">{{ company.name }}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="8px" padding="32px 24px 16px" border="1px solid #e5e5e5">
      <mj-column>
        <mj-text font-size="22px" line-height="30px" font-weight="600" color="#171717">{% if reminder %}Still want to join {{ list.name }}?{% else %}Confirm your subscription{% endif %}</mj-text>
        <mj-text>Hi {{ contact.first_name | default: "there" }},</mj-text>
        <mj-text>{% if reminder %}We have not heard back from you yet. {% endif %}Please confirm that you want to receive emails from {{ company.name }} about <strong style="color:#171717">{{ list.name }}</strong>.</mj-text>
        <mj-text padding="0">{% if list.description != blank %}<p style="margin:0 0 16px;color:#737373;font-size:14px;line-height:22px">{{ list.description }}</p>{% endif %}</mj-text>
        <mj-button href="{{ confirm_url }}">Confirm subscription</mj-button>
        <mj-text font-size="13px" line-height="20px" color="#737373">This link expires in {{ expires_in }}. If you did not sign up, ignore this email and you will not be subscribed.</mj-text>
        <mj-divider border-width="1px" border-color="#e5e5e5" padding="8px 0 16px" />
        <mj-text font-size="12px" line-height="18px" color="#737373">Button not working? Paste this link into your browser:<br /><a class="break" href="{{ confirm_url }}" style="color:#737373">{{ confirm_url }}</a></mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="20px 0 40px">
      <mj-column>
        <mj-text align="center" font-size="12px" line-height="18px" color="#737373">{{ company.name }}{% if company.address != blank %} · {{ company.address }}{% endif %}<br />You are receiving this email because this address was used to sign up for {{ list.name }}.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`

/** One composer per (instance-wide) renderer, shared by every organization. */
const composers = new WeakMap<TemplateRenderer, OptInEmailComposer>()

/**
 * Renders the double opt-in confirmation and reminder emails. MJML is compiled
 * once and the Liquid templates are parsed once; each send only renders variables.
 * Organization-neutral: obtain it with `OptInEmailComposer.for(renderer)` so the
 * compiled templates are shared by every organization of the process.
 */
export class OptInEmailComposer {
  private prepared = new Map<OptInEmailKind, Promise<PreparedEmail>>()

  constructor(private readonly renderer: TemplateRenderer) {}

  /** The shared composer of `renderer` (created on first use). */
  static for(renderer: TemplateRenderer): OptInEmailComposer {
    let composer = composers.get(renderer)

    if (!composer) {
      composer = new OptInEmailComposer(renderer)
      composers.set(renderer, composer)
    }

    return composer
  }

  async render(input: OptInEmailInput): Promise<RenderedEmail> {
    const prepared = await this.prepare(input.kind)

    const variables: OptInVariables = {
      reminder: input.kind === 'reminder',
      contact: input.contact,
      list: input.list,
      company: input.company,
      confirm_url: input.confirmUrl,
      expires_in: OptInEmailComposer.describeDays(input.expiresInDays)
    }

    return prepared.render(variables)
  }

  static describeDays(days: number): string {
    const whole = Math.max(1, Math.round(days))

    return `${whole} ${whole === 1 ? 'day' : 'days'}`
  }

  private prepare(kind: OptInEmailKind): Promise<PreparedEmail> {
    let pending = this.prepared.get(kind)

    if (!pending) {
      pending = this.compile(kind)
      // A failed compilation must not be cached forever.
      pending.catch(() => this.prepared.delete(kind))
      this.prepared.set(kind, pending)
    }

    return pending
  }

  private async compile(kind: OptInEmailKind): Promise<PreparedEmail> {
    const { html } = await this.renderer.compileMjml(OPT_IN_MJML)

    return this.renderer.prepare({ subject: SUBJECTS[kind], html, preheader: PREHEADERS[kind] })
  }
}
