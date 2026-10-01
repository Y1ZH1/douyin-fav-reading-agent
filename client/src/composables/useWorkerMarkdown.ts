import { generateId } from '@/lib/utils'

let worker: Worker | null = null
const pending = new Map<string, { resolve: (html: string) => void; reject: (err: unknown) => void }>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(
    new URL('@/workers/markdown.worker.ts', import.meta.url),
    { type: 'module' },
  )

  worker.onmessage = (e: MessageEvent<{ id: string; html?: string; error?: string }>) => {
    const { id, html, error } = e.data
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    if (error) {
      entry.reject(new Error(error))
    } else {
      entry.resolve(html || '')
    }
  }

  worker.onerror = (err) => {
    console.error('[Worker] Unhandled error:', err)
    // 拒绝所有待处理的请求
    for (const [id, entry] of pending) {
      entry.reject(new Error('Worker crashed'))
      pending.delete(id)
    }
    worker?.terminate()
    worker = null
  }

  worker.onmessageerror = () => {
    console.error('[Worker] Message deserialization failed')
    // Worker 不会收到格式错误的消息 — 拒绝所有待处理请求
    for (const [id, entry] of pending) {
      entry.reject(new Error('Failed to send message to worker'))
      pending.delete(id)
    }
  }

  return worker
}

/**
 * 在 Web Worker 中渲染 Markdown，返回 HTML。
 * 如果 Worker 不可用，回退到主线程渲染。
 */
export async function renderInWorker(content: string): Promise<string> {
  const id = generateId()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try {
      getWorker().postMessage({ id, content })
    } catch (err) {
      pending.delete(id)
      reject(err)
    }
  })
}

/**
 * 终止 Worker 并清理资源。
 * 在应用卸载或需要强制重建 Worker 时调用。
 */
export function terminateWorker(): void {
  if (worker) {
    for (const [id, entry] of pending) {
      entry.reject(new Error('Worker terminated'))
      pending.delete(id)
    }
    worker.terminate()
    worker = null
  }
}
