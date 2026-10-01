import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ChatMessage, ChatSession, MessageStatus } from '@/types/chat'
import { generateId } from '@/lib/utils'
import {
  getDB,
  persistSession as idbPersistSession,
  persistMessage as idbPersistMessage,
  getAllSessions as idbGetAllSessions,
  getMessagesBySession as idbGetMessagesBySession,
  deleteSession as idbDeleteSession,
} from '@/services/persistence'
import {
  saveSession as lsSaveSession,
  loadAllSessions as lsLoadAllSessions,
  deleteSessionFromStorage as lsDeleteSession,
  clearAllStorage as lsClearAll,
} from '@/services/persistence/local-storage'

export const useChatStore = defineStore('chat', () => {
  const sessions = ref<ChatSession[]>([])
  const activeSessionId = ref<string | null>(null)
  const isGenerating = ref(false)
  const abortController = ref<AbortController | null>(null)
  const dbReady = ref(false)

  const activeSession = computed(() =>
    sessions.value.find((s) => s.id === activeSessionId.value) ?? null,
  )

  const activeMessages = computed(() => activeSession.value?.messages ?? [])

  // ── localStorage 同步（即时、同步、无竞态条件）──

  /** 每次变更后将当前活跃会话保存到 localStorage */
  function syncToLS() {
    const session = activeSession.value
    if (!session) return
    try {
      lsSaveSession(session)
    } catch (err) {
      console.warn('[ChatStore] localStorage sync failed:', err)
    }
  }

  /** 将指定会话保存到 localStorage */
  function syncSessionToLS(session: ChatSession) {
    try {
      lsSaveSession(session)
    } catch (err) {
      console.warn('[ChatStore] localStorage sync failed:', err)
    }
  }

  // ── IDB 备份（异步、尽力而为、非阻塞）──

  async function idbBackup(msg: ChatMessage, session: ChatSession) {
    if (!dbReady.value) return
    try {
      await idbPersistMessage(msg)
      await idbPersistSession(session)
    } catch (err) {
      console.warn('[ChatStore] IDB backup failed:', err)
    }
  }

  // ── 初始化 ──

  async function initDB() {
    if (dbReady.value) return

    // 1. 先从 localStorage 加载（同步，始终可用）
    try {
      const lsSessions = lsLoadAllSessions()
      if (lsSessions.length > 0) {
        sessions.value = lsSessions.sort((a, b) => b.updatedAt - a.updatedAt)
        activeSessionId.value = sessions.value[0]?.id ?? null
        console.log(
          `[ChatStore] Loaded ${lsSessions.length} sessions from localStorage`,
        )
        // 已有数据 — 标记就绪并恢复
        dbReady.value = true
        recoverInterrupted()
        // 在后台启动异步 IDB 同步
        initIDBBackfill()
        return
      }
    } catch (err) {
      console.warn('[ChatStore] localStorage load failed:', err)
    }

    // 2. 回退：从 IndexedDB 加载
    try {
      await getDB()
      const saved = await idbGetAllSessions()
      if (saved.length > 0) {
        for (const session of saved) {
          const msgs = await idbGetMessagesBySession(session.id)
          session.messages = msgs
        }
        sessions.value = saved.sort((a, b) => b.updatedAt - a.updatedAt)
        activeSessionId.value = sessions.value[0]?.id ?? null
        console.log(
          `[ChatStore] Loaded ${saved.length} sessions from IndexedDB (fallback)`,
        )
        // 从 IndexedDB 回填 localStorage
        for (const s of sessions.value) {
          lsSaveSession(s)
        }
      }
    } catch (err) {
      console.warn('[ChatStore] IndexedDB load failed:', err)
    }

    dbReady.value = true
    recoverInterrupted()
  }

  /** 用 IndexedDB 的数据回填 localStorage（初始化后运行） */
  async function initIDBBackfill() {
    try {
      await getDB()
      const saved = await idbGetAllSessions()
      if (saved.length > 0) {
        for (const session of saved) {
          const msgs = await idbGetMessagesBySession(session.id)
          session.messages = msgs
          lsSaveSession(session)
        }
        console.log(`[ChatStore] Backfilled ${saved.length} sessions from IDB → localStorage`)
      }
    } catch {
      // 尽力回填 — localStorage 已正确
    }
  }

  /** 清除所有数据（localStorage + IndexedDB） */
  async function clearDB() {
    const { clearAll } = await import('@/services/persistence')
    await clearAll()
    lsClearAll()
    sessions.value = []
    activeSessionId.value = null
    console.log('[ChatStore] All data cleared (localStorage + IndexedDB)')
  }

  // ── 会话管理 ──

  function createSession(
    titleOrOpts?: string | { title?: string; videoName?: string; attachedAwemeIds?: string[] },
  ): string {
    const opts = typeof titleOrOpts === 'string' ? { title: titleOrOpts } : titleOrOpts || {}
    const id = generateId()
    const session: ChatSession = {
      id,
      title: opts.title || '新建对话',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
      pinned: false,
      tags: [],
      model: 'deepseek-v4-flash',
      videoName: opts.videoName,
      attachedAwemeIds: opts.attachedAwemeIds || [],
    }
    sessions.value.unshift(session)
    activeSessionId.value = id
    syncSessionToLS(session)
    // IndexedDB 备份
    if (dbReady.value) {
      idbPersistSession(session).catch((err) =>
        console.warn('[ChatStore] IDB createSession failed:', err),
      )
    }
    return id
  }

  async function deleteSession(id: string) {
    const idx = sessions.value.findIndex((s) => s.id === id)
    if (idx === -1) return
    sessions.value.splice(idx, 1)
    if (activeSessionId.value === id) {
      activeSessionId.value = sessions.value[0]?.id ?? null
    }
    lsDeleteSession(id)
    if (dbReady.value) {
      idbDeleteSession(id).catch((err) =>
        console.warn('[ChatStore] IDB deleteSession failed:', err),
      )
    }
  }

  // ── 消息管理 ──

  function addMessage(role: 'user' | 'assistant', content: string): ChatMessage {
    let session = activeSession.value
    if (!session) {
      createSession()
      session = activeSession.value!
    }

    const msg: ChatMessage = {
      id: generateId(),
      sessionId: session.id,
      role,
      content,
      timestamp: Date.now(),
      status: 'done',
    }

    session.messages.push(msg)
    session.updatedAt = Date.now()
    session.messageCount = session.messages.length

    if (session.messages.length === 1 && role === 'user' && !session.videoName) {
      session.title = content.slice(0, 50) + (content.length > 50 ? '...' : '')
    }

    // 立即保存到 localStorage（同步）
    syncToLS()
    // IndexedDB 备份（异步，尽力而为）
    idbBackup(msg, session)

    return msg
  }

  function createStreamingMessage(): ChatMessage {
    const session = activeSession.value
    if (!session) throw new Error('No active session')

    const msg: ChatMessage = {
      id: generateId(),
      sessionId: session.id,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'streaming',
    }
    session.messages.push(msg)
    return msg
  }

  function appendToMessage(id: string, chunk: string) {
    const session = activeSession.value
    if (!session) return
    const msg = session.messages.find((m) => m.id === id)
    if (msg) msg.content += chunk
  }

  function appendReasoningToMessage(id: string, chunk: string) {
    const session = activeSession.value
    if (!session) return
    const msg = session.messages.find((m) => m.id === id)
    if (msg) msg.reasoningContent = (msg.reasoningContent || '') + chunk
  }

  async function updateMessageStatus(id: string, status: MessageStatus) {
    const session = activeSession.value
    if (!session) {
      console.warn('[ChatStore] updateMessageStatus: no active session')
      return
    }
    const msg = session.messages.find((m) => m.id === id)
    if (!msg) {
      console.warn('[ChatStore] updateMessageStatus: message not found', id)
      return
    }

    msg.status = status
    session.updatedAt = Date.now()
    session.messageCount = session.messages.length

    if (status === 'done' || status === 'error' || status === 'aborted') {
      // 立即保存到 localStorage — 这是权威保存
      syncToLS()
      // IndexedDB 备份（异步，尽力而为 — 无需等待）
      idbBackup(msg, session)
    }
  }

  function updateSessionTitle(id: string, title: string) {
    const session = sessions.value.find((s) => s.id === id)
    if (session) {
      session.title = title
      syncSessionToLS(session)
      if (dbReady.value) {
        idbPersistSession(session).catch((err) =>
          console.warn('[ChatStore] IDB updateTitle failed:', err),
        )
      }
    }
  }

  function togglePinSession(id: string) {
    const session = sessions.value.find((s) => s.id === id)
    if (session) {
      session.pinned = !session.pinned
      syncSessionToLS(session)
      if (dbReady.value) {
        idbPersistSession(session).catch((err) =>
          console.warn('[ChatStore] IDB togglePin failed:', err),
        )
      }
    }
  }

  function clearCurrentSession() {
    const session = activeSession.value
    if (session) {
      session.messages = []
      session.title = '新建对话'
      session.messageCount = 0
      syncToLS()
    }
  }

  function regenerateMessage(messageId: string): ChatMessage | null {
    const session = activeSession.value
    if (!session) return null
    const msgIdx = session.messages.findIndex((m) => m.id === messageId)
    if (msgIdx === -1) return null

    const msg = session.messages[msgIdx]
    if (msg.role !== 'assistant') return null

    const childId = generateId()
    msg.childrenIds = [...(msg.childrenIds || []), childId]

    const newMsg: ChatMessage = {
      id: childId,
      sessionId: session.id,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'regenerating',
      parentId: messageId,
    }

    session.messages.splice(msgIdx + 1, 0, newMsg)
    return newMsg
  }

  // ── 恢复 ──

  function recoverInterrupted() {
    let changed = false
    for (const session of sessions.value) {
      for (const msg of session.messages) {
        if (msg.status === 'streaming' || msg.status === 'sending') {
          if (msg.content.length > 0) {
            msg.status = 'done'
          } else {
            msg.status = 'error'
          }
          changed = true
        }
      }
    }
    if (changed) {
      // 将恢复后的状态保存到 localStorage
      for (const s of sessions.value) {
        lsSaveSession(s)
      }
    }
  }

  function getMessageBranch(messageId: string): ChatMessage[] {
    const session = activeSession.value
    if (!session) return []
    const msg = session.messages.find((m) => m.id === messageId)
    if (!msg) return []
    if (!msg.childrenIds || msg.childrenIds.length === 0) return [msg]
    return [msg, ...msg.childrenIds.flatMap((cid) => getMessageBranch(cid))]
  }

  function switchSession(id: string) {
    activeSessionId.value = id
  }

  function attachAweme(awemeId: string, videoName?: string) {
    const session = activeSession.value
    if (!session || !awemeId) return
    const ids = session.attachedAwemeIds || []
    if (!ids.includes(awemeId)) session.attachedAwemeIds = [...ids, awemeId].slice(0, 4)
    if (!session.videoName && videoName) session.videoName = videoName
    syncSessionToLS(session)
    if (dbReady.value) {
      idbPersistSession(session).catch((err) => console.warn('[ChatStore] IDB attach failed:', err))
    }
  }

  return {
    sessions,
    activeSessionId,
    isGenerating,
    abortController,
    dbReady,
    activeSession,
    activeMessages,
    initDB,
    createSession,
    deleteSession,
    addMessage,
    createStreamingMessage,
    appendToMessage,
    appendReasoningToMessage,
    updateMessageStatus,
    updateSessionTitle,
    togglePinSession,
    clearCurrentSession,
    regenerateMessage,
    recoverInterrupted,
    getMessageBranch,
    clearDB,
    switchSession,
    attachAweme,
  }
})
