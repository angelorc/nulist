<script setup lang="ts">
import type { StorageSettings } from '#shared/types/domain'

definePageMeta({ permission: { settings: ['read'] } })

useSeoMeta({ title: 'Storage settings' })

const NO_PERMISSION = "You don't have permission to change storage settings"

// URL placeholders are bound from script: a literal `//` in a static attribute trips vue-tsc's slot scoping.
const PLACEHOLDERS = { endpoint: 'http://localhost:9000', publicUrl: 'https://cdn.acme.com' }

const PROVIDERS = ['AWS S3', 'Cloudflare R2', 'RustFS', 'MinIO', 'Garage', 'Backblaze B2']

function examplePublicUrl(
  config: Pick<StorageSettings, 'publicUrl' | 'endpoint' | 'bucket' | 'region'>
) {
  const bucket = config.bucket || 'bucket'

  const base =
    config.publicUrl ||
    (config.endpoint
      ? `${config.endpoint.replace(/\/+$/, '')}/${bucket}`
      : `https://${bucket}.s3.${config.region || 'us-east-1'}.amazonaws.com`)

  return `${base.replace(/\/+$/, '')}/uploads/logo.png`
}
</script>

<template>
  <SettingsDocument v-slot="{ state, group, canEdit }" section="storage">
    <SettingsCard
      title="Object storage"
      v-bind="
        group([
          'endpoint',
          'region',
          'bucket',
          'accessKeyId',
          'secretAccessKey',
          'publicUrl',
          'forcePathStyle'
        ])
      "
    >
      <template #description>
        Images and files used in emails are uploaded to an S3-compatible bucket and served from its
        public URL.
        <span class="mt-3 flex flex-wrap gap-1.5">
          <UBadge v-for="name in PROVIDERS" :key="name" :label="name" variant="outline" />
        </span>
      </template>

      <UFormField
        label="Endpoint"
        name="endpoint"
        help="Leave empty for AWS S3. For Cloudflare R2, use your account endpoint ending in r2.cloudflarestorage.com."
      >
        <UInput
          v-model="state.endpoint"
          :placeholder="PLACEHOLDERS.endpoint"
          autocomplete="off"
          spellcheck="false"
          class="w-full"
          :ui="{ base: 'font-mono' }"
        />
      </UFormField>
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="Bucket" name="bucket" required>
          <UInput
            v-model="state.bucket"
            placeholder="mlist"
            spellcheck="false"
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>
        <UFormField label="Region" name="region" help="R2 uses auto; most others accept us-east-1.">
          <UInput
            v-model="state.region"
            placeholder="us-east-1"
            spellcheck="false"
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="Access key ID" name="accessKeyId">
          <UInput
            v-model="state.accessKeyId"
            autocomplete="off"
            spellcheck="false"
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>
        <UFormField label="Secret access key" name="secretAccessKey">
          <SettingsSecretInput v-model="state.secretAccessKey" :disabled="!canEdit" />
        </UFormField>
      </div>
      <UFormField
        label="Public URL"
        name="publicUrl"
        help="Base URL recipients load files from, such as a CDN or custom domain. The bucket must allow public reads."
      >
        <UInput
          v-model="state.publicUrl"
          :placeholder="PLACEHOLDERS.publicUrl"
          autocomplete="off"
          spellcheck="false"
          class="w-full"
          :ui="{ base: 'font-mono' }"
        />
      </UFormField>
      <UFormField name="forcePathStyle">
        <USwitch
          v-model="state.forcePathStyle"
          label="Path-style URLs"
          description="Required by RustFS, MinIO and most self-hosted stores. Turn off for virtual-hosted buckets on AWS."
        />
      </UFormField>
      <div class="space-y-0.5 rounded-md bg-elevated/50 px-3 py-2 ring ring-default">
        <p class="text-xs text-muted">Files will be linked as</p>
        <p class="break-all font-mono text-xs text-highlighted">
          {{ examplePublicUrl(state) }}
        </p>
      </div>
      <p class="flex items-start gap-1.5 text-[13px] text-muted">
        <UIcon name="i-lucide-info" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span
          >Testing the connection creates the bucket with a public-read policy when it does not
          exist yet.</span
        >
      </p>

      <template #actions>
        <SettingsConnectionTest
          endpoint="/api/settings/storage/verify"
          :draft="state"
          :disabled="!canEdit"
          :disabled-reason="NO_PERMISSION"
        />
      </template>
    </SettingsCard>
  </SettingsDocument>
</template>
