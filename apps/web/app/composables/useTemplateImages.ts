import type { FileUploadResult } from '#shared/schemas/files'
import { TemplatesImagePickerModal } from '#components'

/**
 * Images for email templates: uploads to the organization's file manager
 * (with `file:create`) and the "Choose an image" picker, with the outcome told
 * in plain words.
 */
export function useTemplateImages(canUpload: MaybeRefOrGetter<boolean>) {
  const notify = useNotify()
  const overlay = useOverlay()
  const picker = overlay.create(TemplatesImagePickerModal)
  const uploading = ref(0)

  async function upload(files: readonly File[]): Promise<string[]> {
    const images = files.filter((file) => file.type.startsWith('image/'))

    if (!images.length) {
      notify.warning('That file is not an image', {
        description: 'Drop a JPG, PNG or GIF file to add it to the email.'
      })

      return []
    }

    if (!toValue(canUpload)) {
      notify.error("You don't have permission to upload files", undefined, {
        description: 'Pick an existing image from the file manager instead.',
        icon: 'i-lucide-lock'
      })

      return []
    }

    const form = new FormData()

    for (const file of images) form.append('file', file, file.name || 'pasted-image.png')
    uploading.value++

    try {
      const result = await $fetch<FileUploadResult>('/api/files', { method: 'POST', body: form })

      for (const failure of result.errors) {
        notify.error(`Couldn't upload ${failure.name}`, undefined, { description: failure.message })
      }

      const urls = result.items.map((item) => item.url)

      if (urls.length) {
        notify.success(urls.length === 1 ? 'Image uploaded' : `${urls.length} images uploaded`)
      }

      return urls
    } catch (error) {
      notify.error('Upload failed', error)

      return []
    } finally {
      uploading.value--
    }
  }

  /** Opens the picker; resolves with the chosen URL, or `null` when closed. */
  async function pick(current?: string | null): Promise<string | null> {
    return (await picker.open({ current }).result) ?? null
  }

  return { upload, pick, uploading: readonly(uploading) }
}

/** Natural size of an image, so the editor keeps its proportions; `null` when it cannot load. */
export function imageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    const timer = setTimeout(() => resolve(null), 5000)

    image.addEventListener('load', () => {
      clearTimeout(timer)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    })
    image.addEventListener('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    image.src = url
  })
}
