import { readFileSync } from 'node:fs'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'

/**
 * Development only: trusts the certificate in `AWS_CA_BUNDLE` (AWS Emulator's per-run CA) on top
 * of the public ones. `nuxt dev` runs in-process, so NODE_EXTRA_CA_CERTS from .env is read too late.
 */
export default defineNitroPlugin(() => {
  if (!import.meta.dev) return

  const bundle = process.env.AWS_CA_BUNDLE
  if (!bundle) return

  try {
    setDefaultCACertificates([...getCACertificates('default'), readFileSync(bundle, 'utf8')])
  } catch (error) {
    console.warn(
      `[nulist] Could not trust AWS_CA_BUNDLE (${bundle}): is AWS Emulator running?`,
      error
    )
  }
})
