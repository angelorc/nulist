import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const PREFIX = 'enc:v1:'

/**
 * Authenticated symmetric encryption (AES-256-GCM) for secrets stored in the
 * database (provider credentials). The key is derived from the app secret.
 */
export class SecretBox {
  private readonly key: Buffer

  constructor(secret: string) {
    this.key = createHash('sha256').update(`nulist:secret-box:${secret}`).digest()
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX)
  }

  encrypt(plain: string): string {
    if (!plain) return ''
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()

    return PREFIX + Buffer.concat([iv, tag, data]).toString('base64url')
  }

  decrypt(value: string): string {
    if (!value || !this.isEncrypted(value)) return value
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))

    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  }
}
