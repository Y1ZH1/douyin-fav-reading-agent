import { parseSSEStream, type StreamChunk } from './stream-parser'

const API_BASE = '/api'
const STORAGE_KEY = 'ai-code-tutor-settings'

export interface ChatRequest {
  messages: { role: string; content: string }[]
}

/**
 * 从 localStorage 读取用户设置的 API Key 和模型名，
 * 发送到后端，后端优先使用用户传入的值，留空则使用 .env 中的配置。
 */
function getSettings(): { apiKey: string; model: string; replyLanguage: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        apiKey: parsed.apiKey || '',
        model: parsed.model || '',
        replyLanguage: parsed.language || 'auto',
      }
    }
  } catch {
    // 解析失败时忽略
  }
  return { apiKey: '', model: '', replyLanguage: 'auto' }
}

export async function* streamChat(
  messages: ChatRequest['messages'],
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  // 组合外部 signal 和超时 signal（DeepSeek 思考阶段可能长达 60 秒，超时设为 120s）
  const timeoutMs = 120_000
  const timeoutController = new AbortController()
  const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs)

  // 如果外部 signal 中止，也中止超时控制器
  if (signal) {
    signal.addEventListener('abort', () => timeoutController.abort(), { once: true })
  }

  try {
    const response = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...getSettings() }),
      signal: timeoutController.signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`请求失败 (${response.status})${text ? ': ' + text.slice(0, 200) : ''}`)
    }

    yield* parseSSEStream(response)
  } finally {
    clearTimeout(timeoutTimer)
  }
}

export async function* streamExplanation(
  code: string,
  language?: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const response = await fetch(`${API_BASE}/explanation/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, language, ...getSettings() }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Explanation API error: ${response.status} ${response.statusText}`)
  }

  yield* parseSSEStream(response)
}

export async function* streamDiffExplanation(
  oldCode: string,
  newCode: string,
  language?: string,
  signal?: AbortSignal,
  hunks?: { id: string; oldStart: number; newStart: number }[],
): AsyncGenerator<StreamChunk> {
  const response = await fetch(`${API_BASE}/diff/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldCode, newCode, language, hunks, ...getSettings() }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Diff API error: ${response.status} ${response.statusText}`)
  }

  yield* parseSSEStream(response)
}

export interface AnalyzeRequest {
  files: { name: string; content: string }[]
  modes: string[]
  language?: string
}

export async function* streamAnalyze(
  files: { name: string; content: string }[],
  modes: string[],
  language?: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const timeoutMs = 180_000
  const timeoutController = new AbortController()
  const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs)

  if (signal) {
    signal.addEventListener('abort', () => timeoutController.abort(), { once: true })
  }

  try {
    const response = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, modes, language, ...getSettings() }),
      signal: timeoutController.signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Analyze API error (${response.status})${text ? ': ' + text.slice(0, 200) : ''}`)
    }

    yield* parseSSEStream(response)
  } finally {
    clearTimeout(timeoutTimer)
  }
}

