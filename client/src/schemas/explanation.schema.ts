import { z } from 'zod'

export const AIExplanationSectionSchema = z.object({
  hunkId: z.string(),
  title: z.string(),
  detail: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
  learningPoints: z.array(z.string()).optional(),
})

export const AIExplanationSchema = z.object({
  summary: z.string(),
  sections: z.array(AIExplanationSectionSchema),
})

export type AIExplanationSchemaType = z.infer<typeof AIExplanationSchema>
