import { DEFAULT_MJML } from '../../../shared/utils/template-variables'
import type { TemplateKind } from '../../../shared/types/domain'

export type TemplateStarter = 'default' | 'blank'

const HEAD = `  <mj-head>
    <mj-attributes>
      <mj-all font-family="Geist, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" />
      <mj-text font-size="15px" line-height="24px" color="#404040" />
      <mj-button background-color="#171717" color="#ffffff" font-size="14px" font-weight="500" border-radius="6px" inner-padding="10px 18px" />
    </mj-attributes>
  </mj-head>`

const TRANSACTIONAL_MJML = `<mjml>
${HEAD}
  <mj-body background-color="#f5f5f5">
    <mj-section padding="32px 0 8px">
      <mj-column>
        <mj-text font-size="13px" color="#737373">{{ company.name }}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="8px" padding="32px 24px">
      <mj-column>
        <mj-text font-size="22px" line-height="30px" font-weight="600" color="#171717">Hi {{ contact.first_name | default: "there" }},</mj-text>
        <mj-text>Values sent with the API request are available as data variables, for example {{ data.order_id | default: "#1042" }}.</mj-text>
        <mj-button href="{{ data.action_url | default: 'https://example.com' }}">View details</mj-button>
      </mj-column>
    </mj-section>
    <mj-section padding="24px 0 40px">
      <mj-column>
        <mj-text align="center" font-size="12px" line-height="18px" color="#737373">{{ company.name }} · {{ company.address }}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`

const BLANK_MJML = `<mjml>
${HEAD}
  <mj-body background-color="#ffffff">
    <mj-section padding="24px 0">
      <mj-column>
        <mj-text>Start writing here.</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`

/** Starting MJML for new templates. */
export class TemplateStarters {
  static mjml(starter: TemplateStarter, kind: TemplateKind): string {
    if (starter === 'blank') return BLANK_MJML

    return kind === 'transactional' ? TRANSACTIONAL_MJML : DEFAULT_MJML
  }
}
