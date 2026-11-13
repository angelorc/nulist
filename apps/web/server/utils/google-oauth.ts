export interface GoogleOAuthCredentials {
  clientId: string
  clientSecret: string
}

export function googleOAuthCredentials(
  env: Readonly<Record<string, string | undefined>> = process.env
): GoogleOAuthCredentials | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()

  return clientId && clientSecret ? { clientId, clientSecret } : null
}
