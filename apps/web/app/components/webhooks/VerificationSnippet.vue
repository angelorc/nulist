<script setup lang="ts">
/** How a receiver verifies mlist's Standard Webhooks signatures: a Node.js example and the headers. */
const install = 'npm install standardwebhooks'

const nodeExample = `import express from 'express'
import { Webhook } from 'standardwebhooks'

const app = express()
const webhook = new Webhook(process.env.MLIST_WEBHOOK_SECRET) // whsec_…

// Verify the raw body: parsing JSON first changes the bytes that were signed.
app.post('/webhooks/mlist', express.raw({ type: 'application/json' }), (req, res) => {
  let event
  try {
    event = webhook.verify(req.body, req.headers)
  } catch {
    return res.status(400).send('Invalid signature')
  }

  // Deliveries can be retried: use the webhook-id header to skip duplicates.
  switch (event.type) {
    case 'email.bounced':
    case 'email.complained':
      // event.data.to, event.data.id …
      break
  }
  res.sendStatus(204)
})`

const headers = [
  {
    name: 'webhook-id',
    example: '01a1c0eb-2993-7074-a356-14de5994fc06',
    description: 'Unique delivery ID. Stays the same across retries: use it for idempotency.'
  },
  {
    name: 'webhook-timestamp',
    example: '1794238000',
    description: 'Unix seconds when the request was signed. Reject requests older than 5 minutes.'
  },
  {
    name: 'webhook-signature',
    example: 'v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=',
    description:
      'Base64 HMAC-SHA256 of "{id}.{timestamp}.{body}" with the secret, prefixed with the version.'
  }
]

const tabs = [
  { label: 'Node.js', value: 'node', slot: 'node' as const, icon: 'i-lucide-code' },
  { label: 'Headers', value: 'headers', slot: 'headers' as const, icon: 'i-lucide-list' }
]
</script>

<template>
  <div class="space-y-4">
    <p class="text-[13px] text-muted">
      Requests follow the
      <ULink
        to="https://www.standardwebhooks.com"
        target="_blank"
        class="text-primary hover:text-primary hover:underline underline-offset-2"
        >Standard Webhooks</ULink
      >
      spec. Verify every request with the signing secret before trusting the payload, and answer
      with a 2xx status within 15 seconds. Failed deliveries are retried after 5 seconds, 1 minute,
      10 minutes, 1 hour, 4 hours and 12 hours; a
      <code class="font-mono text-xs">410 Gone</code> response disables the endpoint.
    </p>

    <UTabs :items="tabs" variant="link" size="sm" default-value="node" :ui="{ content: 'pt-3' }">
      <template #node>
        <div class="space-y-3">
          <CodeBlock :code="install" label="install command" />
          <CodeBlock :code="nodeExample" label="code example" />
        </div>
      </template>

      <template #headers>
        <dl class="divide-y divide-default rounded-md ring ring-default">
          <div v-for="header in headers" :key="header.name" class="px-3 py-2.5 space-y-1">
            <dt class="flex flex-wrap items-baseline justify-between gap-x-3">
              <code class="font-mono text-xs font-medium text-highlighted">{{ header.name }}</code>
              <code class="font-mono text-xs text-muted truncate max-w-full">{{
                header.example
              }}</code>
            </dt>
            <dd class="text-xs text-muted">
              {{ header.description }}
            </dd>
          </div>
        </dl>
      </template>
    </UTabs>
  </div>
</template>
