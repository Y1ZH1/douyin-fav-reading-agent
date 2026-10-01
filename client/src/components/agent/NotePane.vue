<script setup lang="ts">
/**
 * 中间栏：正在读的那篇转写。
 *
 * 顶上三件事：笔记在电脑上的路径（可复制）、打开所在文件夹、重匹配划线。
 * 下面一行是「和这篇笔记有关的对话」，点一下切过去 —— 材料与会话分离，
 * 但两边要能互相找得到。
 *
 * 划线的落点：选中文字后浮出工具条。工具条上的动作不在这里定义，
 * 全部以事件抛给 AgentView，由它带着当前上下文去调 Agent。
 */
import { computed, ref } from 'vue'
import {
  BookmarkPlus,
  Copy,
  FolderOpen,
  Hash,
  RefreshCw,
  Search,
  Sparkles,
  Tags,
} from 'lucide-vue-next'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
import type { HighlightDeco, Item } from '@/types/agent'
import type { ChatSession } from '@/types/chat'

const props = defineProps<{
  item: Item | null
  noteText: string
  notePath: string
  loading: boolean
  /** 这篇笔记在磁盘上被移走/不存在时的提示 */
  missing: string
  related: ChatSession[]
  activeSessionId: string | null
  highlights: HighlightDeco | null
  rematching: boolean
}>()

const emit = defineEmits<{
  selection: [text: string]
  action: [payload: { kind: 'explain' | 'summarize' | 'add_note' | 'retrieve' | 'classify'; prompt?: string }]
  copyPath: []
  openDir: []
  rematch: []
  switchChat: [id: string]
  newChatFromNote: []
  pinNote: []
}>()

const actionPrompt = ref('')
const copied = ref(false)
const toolbar = ref({ show: false, x: 0, y: 0 })

const staleCount = computed(() => props.highlights?.byStatus?.stale ?? 0)

function onMouseUp() {
  const sel = window.getSelection()
  const text = sel?.toString().trim() || ''
  if (!text || text.length < 2 || !sel?.rangeCount) {
    toolbar.value.show = false
    return
  }
  const r = sel.getRangeAt(0).getBoundingClientRect()
  toolbar.value = { show: true, x: r.left + r.width / 2, y: r.top - 8 }
  emit('selection', text)
}

function fire(kind: 'explain' | 'summarize' | 'add_note' | 'retrieve' | 'classify') {
  toolbar.value.show = false
  emit('action', { kind, prompt: actionPrompt.value })
}

async function copyPath() {
  if (!props.notePath) return
  try {
    await navigator.clipboard.writeText(props.notePath)
    copied.value = true
    setTimeout(() => (copied.value = false), 1200)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <section class="relative flex min-w-0 flex-1 flex-col" @mouseup="onMouseUp">
    <div class="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2 text-xs">
      <span class="min-w-0 flex-1 truncate text-muted-foreground" :title="notePath">
        {{ notePath || '从左边收藏夹打开一篇转写' }}
      </span>
      <button v-if="notePath" class="shrink-0 text-primary" @click="copyPath">
        <Copy class="mr-0.5 inline h-3 w-3" />{{ copied ? '已复制' : '复制路径' }}
      </button>
      <button v-if="notePath" class="shrink-0 text-primary" @click="emit('openDir')">
        <FolderOpen class="mr-0.5 inline h-3 w-3" />打开文件夹
      </button>
    </div>

    <div
      v-if="item"
      class="flex items-center gap-2 overflow-x-auto border-b border-border px-3 py-1.5 text-[11px]"
    >
      <span class="shrink-0 text-muted-foreground">这篇笔记的对话</span>
      <button
        v-for="s in related"
        :key="s.id"
        class="shrink-0 rounded bg-secondary px-2 py-0.5"
        :class="s.id === activeSessionId ? 'ring-1 ring-primary' : ''"
        @click="emit('switchChat', s.id)"
      >
        {{ s.title }}
      </button>
      <span v-if="!related.length" class="shrink-0 text-muted-foreground">还没有</span>
      <button class="shrink-0 text-primary" @click="emit('newChatFromNote')">新建对话</button>
      <button class="shrink-0 text-primary" @click="emit('pinNote')">钉到当前对话</button>
      <span class="ml-auto flex shrink-0 items-center gap-2">
        <span v-if="highlights?.total" class="text-muted-foreground">
          <Hash class="mr-0.5 inline h-3 w-3" />划线 {{ highlights.total }}
          <span v-if="staleCount" class="text-amber-500">（{{ staleCount }} 条没定位上）</span>
        </span>
        <button
          v-if="staleCount"
          class="text-amber-500 disabled:opacity-50"
          title="重转写之后，把划线按指纹重新定位到新正文"
          :disabled="rematching"
          @click="emit('rematch')"
        >
          <RefreshCw class="mr-0.5 inline h-3 w-3" :class="rematching ? 'animate-spin' : ''" />
          重匹配划线
        </button>
      </span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-4 text-sm leading-relaxed">
      <p v-if="loading" class="text-muted-foreground">正在读笔记…</p>
      <p v-else-if="missing" class="text-destructive">{{ missing }}</p>
      <MarkdownRenderer v-else-if="noteText" :content="noteText" />
      <p v-else class="text-muted-foreground">
        还没打开笔记。左边切到「收藏夹」，点开一条已转写的视频。
      </p>
    </div>

    <div
      v-if="toolbar.show && item"
      class="fixed z-50 flex items-center gap-1 rounded-md bg-primary p-1 text-xs text-primary-foreground shadow-lg"
      :style="{ left: toolbar.x + 'px', top: toolbar.y + 'px', transform: 'translate(-50%, -100%)' }"
    >
      <input
        v-model="actionPrompt"
        class="w-44 rounded-sm px-1 py-0.5 text-foreground"
        placeholder="这段话要怎么处理（可留空）"
        @mousedown.stop
      />
      <button class="px-2 py-1" @click="fire('explain')">
        <Sparkles class="mr-0.5 inline h-3 w-3" />解释
      </button>
      <button class="px-2 py-1" @click="fire('summarize')">总结</button>
      <button class="px-2 py-1" @click="fire('add_note')">
        <BookmarkPlus class="mr-0.5 inline h-3 w-3" />入笔记
      </button>
      <button class="px-2 py-1" @click="fire('retrieve')">
        <Search class="mr-0.5 inline h-3 w-3" />检索
      </button>
      <button class="px-2 py-1" @click="fire('classify')">
        <Tags class="mr-0.5 inline h-3 w-3" />分类
      </button>
    </div>
  </section>
</template>
