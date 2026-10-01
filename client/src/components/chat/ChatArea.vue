<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted } from 'vue'
import { useChat } from '@/composables/useChat'
import ChatMessage from './ChatMessage.vue'
import ChatInput from './ChatInput.vue'
import { MessageSquare, AlertTriangle } from 'lucide-vue-next'

const { sendMessage, stopGeneration, regenerateMessage, isGenerating, messages, error, sessions, dbReady } = useChat()

const chatContainerRef = ref<HTMLElement | null>(null)
const chatContentRef = ref<HTMLElement | null>(null)

const hasMessages = computed(() => messages.value.length > 0)

// ── 调试：检测 localStorage 与 store 不一致 ──
const lsHasData = ref(false)
function checkLS() {
  try {
    const raw = localStorage.getItem('ai-tutor:sessions')
    lsHasData.value = raw !== null && raw !== '[]'
  } catch { lsHasData.value = false }
}
onMounted(checkLS)
// dbReady 变化时重新检查
watch(dbReady, (ready) => { if (ready) checkLS() })
const showDebugBanner = computed(() =>
  lsHasData.value && sessions.value.length === 0 && dbReady.value
)

function handleSend(content: string) {
  sendMessage(content)
}

function handleRegenerate(messageId: string) {
  regenerateMessage(messageId)
}

function forceReload() {
  window.location.reload()
}

async function scrollToBottom() {
  await nextTick()
  if (chatContainerRef.value) {
    chatContainerRef.value.scrollTo({
      top: chatContainerRef.value.scrollHeight,
      behavior: 'instant',
    })
  }
}

watch(() => messages.value.length, async () => { await scrollToBottom() })

watch(
  () => {
    const last = messages.value.at(-1)
    return last?.content.length ?? 0
  },
  async () => {
    if (isGenerating.value) await scrollToBottom()
  },
)
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 调试：localStorage 有数据但 store 为空 = 加载失败 -->
    <div
      v-if="showDebugBanner"
      class="flex items-center gap-2 px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/20"
    >
      <AlertTriangle class="h-3.5 w-3.5 text-yellow-400 shrink-0" />
      <span class="text-xs text-yellow-400">
        ⚠ localStorage 中有数据但未加载到页面。请
        <button class="underline hover:text-yellow-300" @click="forceReload">刷新</button>
        或打开控制台查看日志。
      </span>
    </div>

    <div ref="chatContainerRef" class="flex-1 overflow-y-auto">
      <div ref="chatContentRef">
        <div v-if="!hasMessages" class="flex flex-col items-center justify-center h-full min-h-[60vh] px-4 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary/50 mb-6">
            <MessageSquare class="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 class="text-xl font-semibold text-foreground mb-2">AI 代码导师 Pro</h2>
          <p class="text-sm text-muted-foreground max-w-md mb-6">
            问我任何关于代码的问题。我可以解释概念、审查代码、帮助调试问题以及教授编程知识。
          </p>
          <div class="grid grid-cols-2 gap-2 max-w-lg">
            <button
              v-for="prompt in suggestionPrompts"
              :key="prompt"
              class="text-xs text-left px-3 py-2 rounded-lg border border-border bg-secondary/30 text-muted-foreground hover:text-foreground hover:border-ring/50 transition-colors"
              @click="handleSend(prompt)"
            >
              {{ prompt }}
            </button>
          </div>
        </div>

        <template v-else>
          <ChatMessage
            v-for="msg in messages"
            :key="msg.id"
            :message="msg"
            @regenerate="handleRegenerate"
          />
        </template>

        <div
          v-if="error"
          class="mx-4 my-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive"
        >
          {{ error }}
        </div>
      </div>
    </div>

    <ChatInput
      :is-generating="isGenerating"
      @send="handleSend"
      @stop="stopGeneration"
    />
  </div>
</template>

<script lang="ts">
const suggestionPrompts = [
  '解释 JavaScript 中 async/await 的工作原理',
  'Vue 中 ref 和 reactive 有什么区别？',
  '审查这段代码的潜在错误',
  '如何在 async 函数中处理错误？',
  '用示例解释闭包的概念',
  '什么是 TypeScript 泛型？',
]
</script>
