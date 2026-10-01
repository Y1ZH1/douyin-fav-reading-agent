<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage as ChatMessageType } from '@/types/chat'
import MarkdownRenderer from './MarkdownRenderer.vue'
import { User, Bot, AlertCircle, Loader2, RefreshCw, Copy, Check, ChevronDown, ChevronRight, Brain } from 'lucide-vue-next'
import { formatTimestamp } from '@/lib/utils'
import { ref } from 'vue'

const props = defineProps<{ message: ChatMessageType }>()
const emit = defineEmits<{ regenerate: [id: string] }>()

const isUser = computed(() => props.message.role === 'user')
const isStreaming = computed(() => props.message.status === 'streaming')
const isError = computed(() => props.message.status === 'error')
const isAborted = computed(() => props.message.status === 'aborted')
const isDone = computed(() => props.message.status === 'done')
const copied = ref(false)
const reasoningExpanded = ref(false)

const hasReasoning = computed(() => props.message.reasoningContent && props.message.reasoningContent.length > 0)
const showActions = computed(() => isDone.value && props.message.role === 'assistant' && props.message.content.length > 0)

async function copyContent() {
  try {
    await navigator.clipboard.writeText(props.message.content)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch { /* fallback */ }
}
</script>

<template>
  <div
    :class="[
      'flex gap-3 px-4 py-4 group',
      isUser ? 'bg-transparent' : 'bg-secondary/20',
    ]"
  >
    <!-- 头像 -->
    <div class="shrink-0 mt-0.5">
      <div v-if="isUser" class="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-primary">
        <User class="h-3.5 w-3.5" />
      </div>
      <div v-else class="flex h-7 w-7 items-center justify-center rounded-full bg-accent/20 text-accent">
        <Bot class="h-3.5 w-3.5" />
      </div>
    </div>

    <!-- 内容 -->
    <div class="flex-1 min-w-0 space-y-1">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-muted-foreground">
          {{ isUser ? '你' : 'AI 导师' }}
        </span>
        <span class="text-[10px] text-muted-foreground/50">
          {{ formatTimestamp(message.timestamp) }}
        </span>
        <span v-if="message.metadata?.latencyMs" class="text-[10px] text-muted-foreground/30">
          {{ message.metadata.latencyMs }}ms
        </span>
      </div>

      <!-- 思考过程（可折叠） -->
      <div v-if="!isUser && hasReasoning" class="mb-2">
        <button
          class="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors select-none"
          @click="reasoningExpanded = !reasoningExpanded"
        >
          <Brain class="h-3 w-3" />
          <span>思考过程</span>
          <ChevronDown v-if="reasoningExpanded" class="h-3 w-3" />
          <ChevronRight v-else class="h-3 w-3" />
        </button>
        <div
          v-if="reasoningExpanded"
          class="mt-1.5 p-3 rounded-lg bg-secondary/30 border border-border/50 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap"
        >
          <MarkdownRenderer :content="message.reasoningContent || ''" />
          <span
            v-if="isStreaming"
            class="typing-cursor inline-block w-0.5 h-3 bg-muted-foreground animate-pulse align-text-bottom ml-0.5"
          />
        </div>
      </div>

      <div v-if="isUser" class="text-sm text-foreground/90 whitespace-pre-wrap break-words">
        {{ message.content }}
      </div>
      <div v-else class="text-sm">
        <MarkdownRenderer :content="message.content" />
        <span
          v-if="isStreaming"
          class="typing-cursor inline-block w-0.5 h-4 bg-primary animate-pulse align-text-bottom ml-0.5"
        />
      </div>

      <!-- 状态指示器 -->
      <div v-if="isError" class="flex items-center gap-1.5 text-xs text-destructive mt-1">
        <AlertCircle class="h-3 w-3" />
        生成响应时出错
      </div>
      <div v-if="isAborted" class="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
        <Loader2 class="h-3 w-3" />
        生成已停止
      </div>

      <!-- 消息操作按钮（悬停时显示） -->
      <div v-if="showActions" class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity mt-1">
        <button
          class="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-secondary/50 transition-colors"
          @click="copyContent"
        >
          <Check v-if="copied" class="h-3 w-3 text-green-400" />
          <Copy v-else class="h-3 w-3" />
          {{ copied ? '已复制' : '复制' }}
        </button>
        <button
          class="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-secondary/50 transition-colors"
          @click="emit('regenerate', message.id)"
        >
          <RefreshCw class="h-3 w-3" />
          重新生成
        </button>
      </div>
    </div>
  </div>
</template>
