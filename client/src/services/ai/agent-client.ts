import { parseSSEStream } from '@/services/ai/stream-parser'
import type { AgentIntent } from '@/types/agent'

const STORAGE_KEY = 'ai-code-tutor-settings'

function getSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        apiKey: parsed.apiKey || '',
        model: parsed.model || '',
        jevThreshold: Number(parsed.jevThreshold) || 0.72,
        jevMinGap: Number(parsed.jevMinGap) || 0.08,
        explainPrompt: parsed.explainPrompt || '',
        summarizePrompt: parsed.summarizePrompt || '',
        memoryWindowDays: Number(parsed.memoryWindowDays) || 14,
      }
    }
  } catch {
    /* ignore */
  }
  return {
    apiKey: '',
    model: '',
    jevThreshold: 0.72,
    jevMinGap: 0.08,
    explainPrompt: '',
    summarizePrompt: '',
    memoryWindowDays: 14,
  }
}

export type { AgentIntent }

/**
 * Agent 的 SSE 客户端。
 *
 * 注意两点：
 *  1. 划线动作走的是**用户自己写的提示词**（设置页里那份），服务端不再硬编码。
 *  2. 走的是 ReadableStream 手写解析，不用 EventSource —— 因为这里要 POST
 *     一个可能带 8000 字正文的 body，EventSource 只能 GET。
 */
export async function* streamAgent(body: Record<string, unknown>, signal?: AbortSignal) {
  const s = getSettings()
  const response = await fetch('/api/agent/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      apiKey: s.apiKey,
      model: s.model,
      jevThreshold: s.jevThreshold,
      jevMinGap: s.jevMinGap,
      windowDays: s.memoryWindowDays,
      customPrompt:
        (typeof body.customPrompt === 'string' && body.customPrompt) ||
        (body.intent === 'summarize' ? s.summarizePrompt : s.explainPrompt),
    }),
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`请求失败 (${response.status}) ${text.slice(0, 200)}`)
  }
  yield* parseSSEStream(response)
}
