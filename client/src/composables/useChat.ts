import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { streamChat } from '@/services/ai'
import type { ChatMessage } from '@/types/chat'

export function useChat() {
  const store = useChatStore()
  const settingsStore = useSettingsStore()
  const { sessions, activeSessionId, isGenerating, activeMessages: messages, dbReady } = storeToRefs(store)
  const error = ref<string | null>(null)

  /** 获取当前生效的模型名（用户设置优先，否则使用默认值） */
  function getActiveModel(): string {
    return settingsStore.settings.model || 'deepseek-v4-flash'
  }

  onMounted(() => {
    store.initDB().then(() => {
      store.recoverInterrupted()
    })
  })

  async function sendMessage(content: string): Promise<void> {
    if (!content.trim() || isGenerating.value) return

    error.value = null
    store.addMessage('user', content)

    const assistantMsg = store.createStreamingMessage()
    store.isGenerating = true

    const controller = new AbortController()
    store.abortController = controller

    const startTime = Date.now()

    try {
      const apiMessages = messages.value
        .filter((m) => m.id !== assistantMsg.id && m.status !== 'error' && m.status !== 'aborted')
        .map((m) => ({ role: m.role, content: m.content }))

      let firstToken = false
      for await (const chunk of streamChat(apiMessages, controller.signal)) {
        if (!firstToken) {
          assistantMsg.metadata = {
            model: getActiveModel(),
            temperature: 0.7,
            latencyMs: Date.now() - startTime,
          }
          firstToken = true
        }
        if (chunk.content) {
          store.appendToMessage(assistantMsg.id, chunk.content)
        }
        if (chunk.reasoning) {
          store.appendReasoningToMessage(assistantMsg.id, chunk.reasoning)
        }
      }

      assistantMsg.metadata = {
        ...assistantMsg.metadata,
        model: getActiveModel(),
        temperature: 0.7,
        latencyMs: assistantMsg.metadata?.latencyMs ?? Date.now() - startTime,
        totalLatencyMs: Date.now() - startTime,
      }
      // 等待持久化完成，确保消息状态/内容在函数解析前安全写入 IndexedDB。
      // 如果没有这一步，用户在 fire-and-forget 写入完成前刷新页面会丢失数据。
      await store.updateMessageStatus(assistantMsg.id, 'done')
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        await store.updateMessageStatus(assistantMsg.id, 'aborted')
      } else {
        error.value = e instanceof Error ? e.message : 'Unknown error'
        await store.updateMessageStatus(assistantMsg.id, 'error')
      }
    } finally {
      store.isGenerating = false
      store.abortController = null
    }
  }

  function stopGeneration(): void {
    store.abortController?.abort()
    store.isGenerating = false
    const lastMsg = messages.value.at(-1)
    if (lastMsg && lastMsg.status === 'streaming') {
      store.updateMessageStatus(lastMsg.id, 'aborted')
    }
  }

  function retryLastMessage(): void {
    const msgs = messages.value
    if (msgs.length < 2) return

    const lastUserMsg = [...msgs].reverse().find((m: ChatMessage) => m.role === 'user')
    if (!lastUserMsg) return

    for (let i = msgs.length - 1; i >= 0; i--) {
      if (
        msgs[i].role === 'assistant' &&
        (msgs[i].status === 'error' || msgs[i].status === 'aborted')
      ) {
        const session = store.activeSession
        if (session) session.messages.splice(i, 1)
        break
      }
    }

    sendMessage(lastUserMsg.content)
  }

  function regenerateMessage(messageId: string): void {
    const session = store.activeSession
    if (!session) return

    const msgIdx = session.messages.findIndex((m) => m.id === messageId)
    if (msgIdx === -1) return

    const msg = session.messages[msgIdx]
    if (msg.role !== 'assistant') return

    // 寻找前一条用户消息作为 API 上下文
    const apiMessages = session.messages
      .slice(0, msgIdx)
      .filter((m) => m.status !== 'error' && m.status !== 'aborted')
      .map((m) => ({ role: m.role, content: m.content }))

    // 重置已有消息并复用
    msg.content = ''
    msg.reasoningContent = ''
    msg.status = 'streaming'
    msg.metadata = undefined

    store.isGenerating = true
    const controller = new AbortController()
    store.abortController = controller

    ;(async () => {
      try {
        for await (const chunk of streamChat(apiMessages, controller.signal)) {
          if (chunk.content) store.appendToMessage(msg.id, chunk.content)
          if (chunk.reasoning) store.appendReasoningToMessage(msg.id, chunk.reasoning)
        }
        await store.updateMessageStatus(msg.id, 'done')
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          await store.updateMessageStatus(msg.id, 'aborted')
        } else {
          await store.updateMessageStatus(msg.id, 'error')
        }
      } finally {
        store.isGenerating = false
        store.abortController = null
      }
    })()
  }

  function switchSession(id: string) {
    store.activeSessionId = id
  }

  return {
    error,
    dbReady,
    sendMessage,
    stopGeneration,
    retryLastMessage,
    regenerateMessage,
    switchSession,
    createSession: store.createSession,
    deleteSession: store.deleteSession,
    togglePinSession: store.togglePinSession,
    sessions,
    activeSessionId,
    isGenerating,
    messages,
  }
}
