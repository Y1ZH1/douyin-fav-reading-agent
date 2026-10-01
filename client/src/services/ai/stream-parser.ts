export interface StreamChunk {
  content?: string
  reasoning?: string
  event?: string
  data?: unknown
}

export async function* parseSSEStream(response: Response): AsyncGenerator<StreamChunk> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return

      try {
        const parsed = JSON.parse(data)
        if (parsed.error) throw new Error(parsed.error)
        if (parsed.event) {
          yield { event: parsed.event, data: parsed.data, content: parsed.event === 'token' ? parsed.data?.content : undefined, reasoning: parsed.event === 'token' ? parsed.data?.reasoning : undefined }
          continue
        }
        if (parsed.content) yield { content: parsed.content }
        if (parsed.reasoning) yield { reasoning: parsed.reasoning }
      } catch (e) {
        if (e instanceof SyntaxError) continue
        throw e
      }
    }
  }
}

export function createSSEResponse(headers?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...headers,
  }
}
