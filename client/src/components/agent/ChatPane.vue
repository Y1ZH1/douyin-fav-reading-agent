<script setup lang="ts">
/**
 * 右栏：这场对话。
 *
 * 产品规格是「材料与会话分离」，所以这一栏不显示笔记库，只显示
 * 这场对话本身 —— 钉了哪几篇、消息、工具轨迹、追问芯片、要不要人确认。
 *
 * 空对话里刻意放了两个显式入口：
 *  - 「先给我一批候选」→ propos，Agent 检索后提案，用户勾选再钉
 *  - 「从行为日志编译习惯」→ memory_compile，草稿走 HITL 确认
 * 这两个都是 P1 里原来「做得较浅」的部分，现在有完整闭环。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { Brain, Pin, Search, Send, Square, Sparkles, Wrench } from 'lucide-vue-next'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
import type { AgentState, Trace } from '@/types/agent'
import type { ChatMessage, ChatSession } from '@/types/chat'

const props = defineProps<{
  session: ChatSession | null
  messages: ChatMessage[]
  busy: boolean
  agentState: AgentState
  streamErr: string
  chips: string[]
  traces: Record<string, Trace[]>
  /** 从候选托盘「只 @」过来的标题，追加到输入框 */
  mentionTitles: string[]
}>()

const emit = defineEmits<{
  submit: [text: string]
  followup: [text: string]
  abort: []
  propose: []
  compileMemory: []
  openTrace: [name: string]
}>()

const input = ref('')
const scroller = ref<HTMLElement | null>(null)
const openTrace = ref<Record<string, boolean>>({})

const stateLabel = computed(() => {
  switch (props.agentState) {
    case 'tool':
      return '正在调用工具…'
    case 'streaming':
      return '正在生成…'
    case 'hitl':
      return '等你确认'
    case 'followup':
      return '正在想追问…'
    default:
      return ''
  }
})

watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'smooth' })
  },
)

watch(
  () => props.mentionTitles,
  (titles) => {
    if (!titles.length) return
    const mentions = titles.map((t) => `@${t}`).join(' ')
    input.value = `${mentions} ${input.value}`.trim()
  },
)

function submit() {
  const text = input.value.trim()
  if (!text || props.busy) return
  input.value = ''
  emit('submit', text)
}

function toggleTrace(id: string) {
  openTrace.value[id] = !openTrace.value[id]
}
</script>

<template>
  <aside class="flex w-[400px] shrink-0 flex-col border-l border-border">
    <div class="border-b border-border px-3 py-2">
      <div class="truncate text-sm font-semibold">{{ session?.title || '对话' }}</div>
      <p class="truncate text-[11px] text-muted-foreground">
        <template v-if="session?.attachedAwemeIds?.length">
          <Pin class="mr-0.5 inline h-3 w-3" />已钉 {{ session.attachedAwemeIds.length }} 篇
        </template>
        <template v-else>这场对话还没钉笔记。没钉就读不到笔记内容。</template>
        <span v-if="session?.videoName"> · {{ session.videoName }}</span>
      </p>
    </div>

    <p v-if="stateLabel && !streamErr" class="border-b border-border px-3 py-1 text-[11px] text-primary">
      {{ stateLabel }}
    </p>
    <p v-if="streamErr" class="border-b border-border px-3 py-2 text-[11px] leading-relaxed text-destructive">
      {{ streamErr }}
    </p>

    <div ref="scroller" class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <div v-if="!messages.length" class="space-y-3 py-6 text-center">
        <p class="text-xs leading-relaxed text-muted-foreground">
          这场对话是空的。<br />
          可以直接问，也可以先让 Agent 找一批候选笔记。
        </p>
        <div class="flex flex-col items-center gap-2">
          <button
            class="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary/50 disabled:opacity-50"
            :disabled="busy"
            @click="emit('propose')"
          >
            <Search class="h-3.5 w-3.5" /> 先给我一批候选笔记
          </button>
          <button
            class="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary/50 disabled:opacity-50"
            :disabled="busy"
            @click="emit('compileMemory')"
          >
            <Brain class="h-3.5 w-3.5" /> 从行为日志编译习惯
          </button>
        </div>
      </div>

      <div v-for="m in messages" :key="m.id" class="text-sm">
        <div class="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {{ m.role === 'user' ? '你' : 'Agent' }}
        </div>
        <details
          v-if="traces[m.id]?.length"
          class="mb-1 rounded border border-border/60 px-1.5 py-1 text-[10px] text-muted-foreground"
          :open="openTrace[m.id]"
        >
          <summary class="cursor-pointer select-none" @click="toggleTrace(m.id)">
            <Wrench class="mr-0.5 inline h-3 w-3" />用过的工具（{{ traces[m.id].length }}）
          </summary>
          <div v-for="(t, i) in traces[m.id]" :key="i" class="mt-1 border-t border-border/40 pt-1">
            <div class="font-medium text-foreground/80">{{ t.name }}</div>
            <pre class="whitespace-pre-wrap break-all opacity-80">{{ JSON.stringify(t.args) }}</pre>
            <pre class="whitespace-pre-wrap break-all opacity-60">{{ JSON.stringify(t.result)?.slice(0, 400) }}</pre>
          </div>
        </details>
        <MarkdownRenderer v-if="m.role === 'assistant'" :content="m.content" />
        <div v-else class="whitespace-pre-wrap">{{ m.content }}</div>
        <p
          v-if="m.status === 'streaming'"
          class="mt-0.5 text-[10px] text-muted-foreground"
        >
          正在写…
        </p>
      </div>
    </div>

    <slot name="proposals" />
    <slot name="hitl" />

    <div v-if="chips.length" class="flex flex-wrap gap-1 border-t border-border p-2">
      <button
        v-for="c in chips"
        :key="c"
        class="rounded-full bg-secondary px-2 py-1 text-[11px] hover:bg-secondary/70 disabled:opacity-50"
        :disabled="busy"
        @click="emit('followup', c)"
      >
        {{ c }}
      </button>
    </div>

    <form class="flex items-center gap-2 border-t border-border p-2" @submit.prevent="submit">
      <input
        v-model="input"
        class="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none"
        :placeholder="session?.attachedAwemeIds?.length ? '接着问这篇笔记…' : '问点什么，或说「去库里找…」'"
        :disabled="busy"
      />
      <button
        v-if="busy"
        type="button"
        class="flex items-center gap-1 text-xs text-destructive"
        @click="emit('abort')"
      >
        <Square class="h-3 w-3" />停
      </button>
      <button v-else type="submit" class="flex items-center gap-1 text-xs text-primary" :disabled="!input.trim()">
        <Send class="h-3 w-3" />发送
      </button>
    </form>
    <p class="border-t border-border px-2 py-1 text-[10px] text-muted-foreground/70">
      <Sparkles class="mr-0.5 inline h-3 w-3" />
      没说要找内容时不会去检索；检索命中也不会自动钉进这场对话。
    </p>
  </aside>
</template>
