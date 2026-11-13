<script setup lang="ts">
/**
 * Pretty-printed, highlighted JSON viewer (event payloads, audit data). Strings holding JSON,
 * such as an SNS `Message`, are expanded in place; other raw strings are shown as plain text.
 *
 * <JsonBlock :value="event.payload" label="Payload" />
 */
const props = withDefaults(
  defineProps<{ value: unknown; label?: string; maxHeight?: string; wrap?: boolean }>(),
  { label: 'JSON', maxHeight: undefined, wrap: true }
)

const formatter = new JsonFormatter()

const formatted = computed<FormattedJson>(() => {
  const json = jsonValueSchema.safeParse(props.value)

  if (json.success) return formatter.format(json.data)

  return { code: JSON.stringify(props.value, null, formatter.indent) ?? '', lang: 'json' }
})
</script>

<template>
  <CodeBlock
    :code="formatted.code"
    :label="label"
    :lang="formatted.lang"
    :wrap="wrap"
    v-bind="maxHeight ? { maxHeight } : {}"
  />
</template>
