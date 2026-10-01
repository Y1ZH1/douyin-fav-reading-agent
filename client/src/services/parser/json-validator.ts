import { z } from 'zod'
import { AIExplanationSchema } from '@/schemas'
import { aiErrorRecovery } from '@/services/ai/error-recovery'
import type { AIExplanation } from '@/types'

export interface ValidationResult<T> {
  success: boolean
  data?: T
  errors?: string[]
  repaired: boolean
}

export function validateAIExplanation(raw: string): ValidationResult<AIExplanation> {
  let repaired = false
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    const fixed = aiErrorRecovery.repair(raw)
    try {
      parsed = JSON.parse(fixed)
      repaired = true
    } catch {
      return { success: false, errors: ['Failed to parse JSON after repair attempts'], repaired: false }
    }
  }

  const result = AIExplanationSchema.safeParse(parsed)
  if (result.success) {
    return { success: true, data: result.data as AIExplanation, repaired }
  }

  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    repaired: false,
  }
}

export function validateJSON<T>(raw: string, schema: z.ZodType<T>): ValidationResult<T> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const fixed = aiErrorRecovery.repair(raw)
    try {
      parsed = JSON.parse(fixed)
    } catch {
      return { success: false, errors: ['Invalid JSON'], repaired: false }
    }
  }

  const result = schema.safeParse(parsed)
  if (result.success) {
    return { success: true, data: result.data, repaired: false }
  }

  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    repaired: false,
  }
}

export function extractJSONFromMarkdown(markdown: string): string | null {
  const jsonBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/g
  const matches = [...markdown.matchAll(jsonBlockRegex)]
  if (matches.length > 0) {
    return matches[matches.length - 1][1].trim()
  }

  const braceMatch = markdown.match(/\{[\s\S]*\}/)
  if (braceMatch) {
    return braceMatch[0]
  }

  return null
}
