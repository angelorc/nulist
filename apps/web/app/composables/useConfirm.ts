import { ConfirmModal } from '#components'

/** What a confirmation states (DESIGN.md §5: the object and the consequence). */
export interface ConfirmOptions {
  /** The question, naming the object: `Delete "Spring sale"?` */
  title: string
  /** The consequence: "This can't be undone." */
  description?: string
  /** The action, as a verb: "Delete broadcast". Defaults to "Confirm". */
  confirmLabel?: string
  /** Defaults to "Cancel". */
  cancelLabel?: string
  /** Destructive action: the confirm button turns red. */
  danger?: boolean
}

/**
 * Promise based confirmation dialog: `if (await confirm({ title })) …`.
 * Each confirmation mounts its own modal and removes it once closed.
 */
export function useConfirm() {
  const overlay = useOverlay()

  return async (options: ConfirmOptions): Promise<boolean> => {
    const modal = overlay.create(ConfirmModal, { destroyOnClose: true })

    return Boolean(await modal.open(options).result)
  }
}
