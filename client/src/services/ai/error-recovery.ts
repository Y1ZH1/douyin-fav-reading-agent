import type { z } from 'zod'

export class AIErrorRecovery {
  repair(raw: string): string {
    let fixed = raw

    fixed = this.closeUnterminated(fixed)
    fixed = this.trimIncompleteTrailingProperty(fixed)

    fixed = fixed
      .replace(/,\s*}/g, '}')
      .replace(/,\s*\]/g, ']')
      .replace(/,\s*,/g, ',')

    return fixed
  }

  degrade(invalid: unknown, _schema: z.ZodType, errors: z.ZodError): unknown {
    if (typeof invalid === 'object' && invalid !== null) {
      const obj = invalid as Record<string, unknown>
      const errorPaths = new Set(errors.issues.map((i) => i.path.join('.')))

      const cleaned: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        if (!errorPaths.has(key)) {
          cleaned[key] = value
        }
      }
      return cleaned
    }
    return invalid
  }

  private closeUnterminated(json: string): string {
    let depth = 0
    let inString = false
    let escaped = false

    for (const ch of json) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '{' || ch === '[') depth++
      if (ch === '}' || ch === ']') depth--
    }

    while (depth > 0) {
      const trimmed = json.trimEnd()
      json += trimmed.endsWith('[') || trimmed.endsWith('{') ? '}' : ''
      depth--
    }
    return json
  }

  private trimIncompleteTrailingProperty(json: string): string {
    const lastComma = json.lastIndexOf(',"')
    const lastBrace = json.lastIndexOf('}')
    if (lastComma > lastBrace) {
      return json.substring(0, lastComma) + '\n}'
    }
    return json
  }
}

export const aiErrorRecovery = new AIErrorRecovery()
