import type { ButtonProps } from '@nuxt/ui'
import { signInErrorSchema } from '#shared/schemas/access'

export interface GoogleSignInOptions {
  callbackURL: string
  errorCallbackURL?: string
  label?: string
}

export function useGoogleSignIn(options: MaybeRefOrGetter<GoogleSignInOptions>) {
  const route = useRoute()
  const organization = useOrganization()
  const { execute, status, error } = useSignIn('social')

  const pending = computed(() => status.value === 'pending' || status.value === 'success')

  const failure = computed(
    () => signInErrorSchema.safeParse(route.query.error).data ?? error.value?.message ?? null
  )

  async function signIn(): Promise<void> {
    const { callbackURL, errorCallbackURL } = toValue(options)

    organization.clear()
    await execute({
      provider: 'google',
      callbackURL,
      errorCallbackURL: errorCallbackURL ?? route.path
    })
  }

  const provider = computed<ButtonProps>(() => ({
    label: toValue(options).label ?? 'Continue with Google',
    icon: 'i-logos-google-icon',
    color: 'neutral',
    variant: 'outline',
    size: 'lg',
    block: true,
    class: 'font-medium hover:bg-elevated/60 transition-colors',
    ui: { leadingIcon: 'size-4.5' },
    loading: pending.value,
    onClick: () => void signIn()
  }))

  return { signIn, pending, failure, provider }
}
