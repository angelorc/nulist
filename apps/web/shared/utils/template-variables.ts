/** Liquid variables available in every template. Documented in the editor side panel. */
export const TEMPLATE_VARIABLES = [
  { name: 'contact.email', description: 'Recipient email address' },
  { name: 'contact.first_name', description: 'First name (use | default: "there")' },
  { name: 'contact.last_name', description: 'Last name' },
  { name: 'contact.attributes.<key>', description: 'Any custom attribute' },
  { name: 'unsubscribe_url', description: 'One-click unsubscribe link (required for marketing)' },
  { name: 'preferences_url', description: 'Preference center link' },
  { name: 'web_url', description: 'View in browser link' },
  { name: 'company.name', description: 'Company name from settings' },
  { name: 'company.address', description: 'Postal address from settings (CAN-SPAM)' },
  { name: 'data.<key>', description: 'Transactional payload variables' }
] as const

export const DEFAULT_MJML = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Geist, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" />
      <mj-text font-size="15px" line-height="24px" color="#404040" />
      <mj-button background-color="#171717" color="#ffffff" font-size="14px" font-weight="500" border-radius="6px" inner-padding="10px 18px" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f5f5f5">
    <mj-section padding="32px 0 8px">
      <mj-column>
        <mj-text font-size="13px" color="#737373">{{ company.name }}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" border-radius="8px" padding="32px 24px">
      <mj-column>
        <mj-text font-size="22px" line-height="30px" font-weight="600" color="#171717">Hi {{ contact.first_name | default: "there" }},</mj-text>
        <mj-text>Write something worth reading. Keep it short, specific and useful.</mj-text>
        <mj-button href="https://example.com">Read more</mj-button>
      </mj-column>
    </mj-section>
    <mj-section padding="24px 0 40px">
      <mj-column>
        <mj-text align="center" font-size="12px" line-height="18px" color="#737373">
          {{ company.name }} · {{ company.address }}<br />
          <a href="{{ preferences_url }}" style="color:#737373">Manage preferences</a> · <a href="{{ unsubscribe_url }}" style="color:#737373">Unsubscribe</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`
