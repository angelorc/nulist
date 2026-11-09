import { z } from 'zod'

const topicName = z.string().trim().min(1, 'Name is required').max(80)
const topicDescription = z.string().trim().max(300).nullish()

export const topicInputSchema = z.object({
  name: topicName,
  description: topicDescription,
  defaultSubscribed: z.boolean().default(true)
})

export type TopicInput = z.output<typeof topicInputSchema>

export type TopicInputState = z.input<typeof topicInputSchema>

/** PATCH body: only the provided fields change (no defaults applied). */
export const topicUpdateSchema = z.object({
  name: topicName.optional(),
  description: topicDescription,
  defaultSubscribed: z.boolean().optional()
})

export type TopicUpdate = z.output<typeof topicUpdateSchema>

export const topicPreferenceSchema = z.object({
  topicId: z.uuid(),
  subscribed: z.boolean()
})
