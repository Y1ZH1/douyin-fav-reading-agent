/**
 * 基于 localStorage 的会话持久化。
 *
 * 与 IndexedDB 不同，localStorage 的读写是同步的，没有事务竞争——
 * 写入的内容在下次读取时立即可用。我们将其作为聊天会话的权威持久化层。
 *
 * 存储策略（热/冷）：
 *   - localStorage：会话元数据 + 每个会话最近 20 条消息（热缓存）
 *   - IndexedDB：完整历史记录（冷存储）
 *   - LRU 淘汰：当存储接近容量时，移除旧的未固定会话
 */
import { toRaw } from 'vue'
import type { ChatSession, ChatMessage } from '@/types/chat'

const SESSIONS_KEY = 'ai-tutor:sessions'
const MESSAGES_PREFIX = 'ai-tutor:msgs:'
const MAX_MESSAGES_PER_SESSION = 20

/** 去除 Vue 响应式代理 — 返回纯 JSON 安全对象 */
function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(toRaw(obj)))
}

/** 检查 localStorage 使用量，若接近容量则淘汰旧的未固定消息 */
function ensureQuota(): void {
  try {
    // 先尝试写入测试项以检测是否超出配额
    const testKey = '__quota_test__'
    localStorage.setItem(testKey, 'x'.repeat(1000))
    localStorage.removeItem(testKey)
  } catch {
    // 超出配额 — 淘汰最旧的未固定会话的消息数据
    console.warn('[LS] ⚠️ localStorage quota near limit, evicting oldest unpinned session')
    const sessions = loadSessionMetaList()
    const unpinned = sessions.filter((s) => !s.pinned).sort((a, b) => a.updatedAt - b.updatedAt)
    if (unpinned.length > 0) {
      const victim = unpinned[0]
      localStorage.removeItem(MESSAGES_PREFIX + victim.id)
      console.log(`[LS] 🗑️ Evicted messages for session "${victim.title}" (${victim.id})`)
    }
  }
}

export function saveSession(session: ChatSession): void {
  try {
    // 序列化前深度去除 Vue 响应式代理
    const plain = toPlain(session)
    const { messages, ...meta } = plain as ChatSession & { messages: ChatMessage[] }

    // 只保留最近的消息（热缓存，完整历史在 IDB 中）
    const recentMessages = messages.slice(-MAX_MESSAGES_PER_SESSION)

    const sessions = loadSessionMetaList()
    const idx = sessions.findIndex((s) => s.id === plain.id)
    if (idx >= 0) {
      sessions[idx] = meta
    } else {
      sessions.push(meta)
    }

    const metaJson = JSON.stringify(sessions)
    const msgsJson = JSON.stringify(recentMessages)

    // 写入前检查配额
    ensureQuota()

    localStorage.setItem(SESSIONS_KEY, metaJson)
    localStorage.setItem(MESSAGES_PREFIX + plain.id, msgsJson)
  } catch (err) {
    console.warn('[LS] ❌ Failed to save session:', err)
  }
}

export function loadAllSessions(): ChatSession[] {
  try {
    const metas = loadSessionMetaList()
    console.log(
      `%c[LS] 📖 Loading ${metas.length} session(s) from localStorage`,
      'color: #60a5fa',
    )
    const result = metas.map((meta) => {
      const raw = localStorage.getItem(MESSAGES_PREFIX + meta.id)
      let messages: ChatMessage[] = []
      if (raw) {
        try {
          messages = JSON.parse(raw)
        } catch {
          console.warn(`[LS] Corrupted messages for session ${meta.id}`)
        }
      }
      console.log(
        `  [LS] Session "${meta.title}": ${messages.length} messages`,
      )
      return { ...meta, messages } as ChatSession
    })

    if (result.length === 0) {
      console.log('%c[LS] 📭 No sessions in localStorage', 'color: #fbbf24')
    }

    return result
  } catch (err) {
    console.warn('[LS] ❌ Failed to load sessions:', err)
    return []
  }
}

export function deleteSessionFromStorage(sessionId: string): void {
  try {
    const sessions = loadSessionMetaList().filter((s) => s.id !== sessionId)
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
    localStorage.removeItem(MESSAGES_PREFIX + sessionId)
    console.log(`[LS] 🗑️ Deleted session ${sessionId}`)
  } catch (err) {
    console.warn('[LS] ❌ Failed to delete session:', err)
  }
}

export function clearAllStorage(): void {
  try {
    const sessions = loadSessionMetaList()
    for (const s of sessions) {
      localStorage.removeItem(MESSAGES_PREFIX + s.id)
    }
    localStorage.removeItem(SESSIONS_KEY)
    console.log('[LS] 🧹 Cleared all session data')
  } catch (err) {
    console.warn('[LS] ❌ Failed to clear storage:', err)
  }
}

/** 内部方法：仅加载会话元数据列表 */
function loadSessionMetaList(): Array<Omit<ChatSession, 'messages'>> {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch {
    console.warn('[LS] Corrupted session metadata')
    return []
  }
}
