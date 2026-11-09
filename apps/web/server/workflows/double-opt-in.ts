import { createHook, sleep } from 'workflow'
import { HookForceClaimedError } from 'workflow/errors'
import { expireOptInStep, sendOptInConfirmationStep, sendOptInReminderStep } from './steps/optin'

/** Days after the first email before the single reminder goes out. */
const REMINDER_AFTER_DAYS = 2

interface OptInAnswer {
  confirmed: boolean
}

export type DoubleOptInOutcome =
  | { status: 'confirmed' | 'declined' | 'expired' | 'resolved' }
  | { status: 'skipped'; reason: string }
  | { status: 'superseded' | 'duplicate'; runId: string }

/** Waits for the recipient's answer or the timer, whichever comes first. */
async function answerWithin(
  answer: Promise<OptInAnswer>,
  days: number
): Promise<OptInAnswer | null> {
  if (days <= 0) return null

  return Promise.race([answer, sleep(`${days}d`).then(() => null)])
}

/**
 * Double opt-in for one (contact, list) pair of an organization:
 * confirmation email → wait (2 days) → one reminder → wait (rest of the expiry) → expire.
 * The confirm endpoint resumes the hook `optin:<contactId>:<listId>` (ids are globally
 * unique, so the token needs no organization). A newer signup for the same pair takes the
 * hook over (newest run wins) and this run steps aside.
 * `organizationId` is the trailing argument so runs started before organizations existed
 * replay unchanged; every step receives it and resolves it from the contact when absent.
 */
export async function doubleOptInWorkflow(
  contactId: string,
  listId: string,
  organizationId?: string
): Promise<DoubleOptInOutcome> {
  'use workflow'

  using hook = createHook<OptInAnswer>({
    token: `optin:${contactId}:${listId}`,
    experimental_force: true
  })

  // Commit the hook before the email goes out, so an instant click always finds it.
  const conflict = await hook.getConflict()

  if (conflict) return { status: 'duplicate', runId: conflict.runId }
  const answer = hook.then((payload) => payload)

  try {
    const sent = await sendOptInConfirmationStep(contactId, listId, organizationId)

    if (sent.status === 'skipped' && sent.reason !== 'recently_sent')
      return { status: 'skipped', reason: sent.reason }

    if (sent.status === 'suppressed') {
      // The address can't receive the email, so it can never be confirmed.
      await expireOptInStep(contactId, listId, organizationId)

      return { status: 'skipped', reason: `suppressed: ${sent.reason}` }
    }

    const expiryDays = sent.expiryDays
    const reminderAfter = expiryDays > REMINDER_AFTER_DAYS ? REMINDER_AFTER_DAYS : 0

    if (reminderAfter > 0) {
      const early = await answerWithin(answer, reminderAfter)

      if (early) return { status: early.confirmed ? 'confirmed' : 'declined' }

      const reminder = await sendOptInReminderStep(
        contactId,
        listId,
        expiryDays - reminderAfter,
        organizationId
      )

      // Confirmed (or removed) while we were waiting and the hook was not resumed.
      if (reminder.status === 'skipped' && reminder.reason === 'not_pending')
        return { status: 'resolved' }
    }

    const late = await answerWithin(answer, expiryDays - reminderAfter)

    if (late?.confirmed) return { status: 'confirmed' }
    const { expired } = await expireOptInStep(contactId, listId, organizationId)

    return { status: late ? 'declined' : expired ? 'expired' : 'resolved' }
  } catch (error) {
    if (HookForceClaimedError.is(error))
      return { status: 'superseded', runId: error.claimedByRunId }
    throw error
  }
}
