<script setup lang="ts">
/**
 * 最左栏：只有两个切换 ——「对话」和「收藏夹」。产品规格明确要求，
 * 不要再出现第四栏、也不要再出现第二份视频列表。
 *
 * 「对话」每一项两行：上一行对话标题，下一行视频名。
 * 「收藏夹」两层：第一层收藏夹，第二层里面已转写的视频；没归类的单独一组。
 */
import { computed, ref } from 'vue'
import { FolderOpen, Plus, RefreshCw, Settings, Trash2 } from 'lucide-vue-next'
import type { Item } from '@/types/agent'
import type { ChatSession } from '@/types/chat'

const props = defineProps<{
  items: Item[]
  sessions: ChatSession[]
  activeAwemeId?: string
  activeSessionId: string | null
  loading: boolean
  error: string
}>()

const emit = defineEmits<{
  openItem: [item: Item]
  openChat: [id: string]
  newChat: []
  newChatFromNote: []
  deleteChat: [id: string]
  refresh: []
}>()

const tab = ref<'chats' | 'folders'>('folders')
const q = ref('')
const closed = ref<Record<string, boolean>>({})

const filtered = computed(() =>
  props.items.filter((i) => !q.value || i.title.toLowerCase().includes(q.value.toLowerCase())),
)

const groups = computed(() => {
  const map = new Map<string, Item[]>()
  for (const it of filtered.value) {
    for (const name of it.folders?.length ? it.folders : ['未归类']) {
      if (!map.has(name)) map.set(name, [])
      map.get(name)!.push(it)
    }
  }
  return [...map.entries()].sort((a, b) =>
    a[0] === '未归类' ? 1 : b[0] === '未归类' ? -1 : b[1].length - a[1].length,
  )
})

function toggle(name: string) {
  closed.value[name] = !closed.value[name]
}
</script>

<template>
  <aside class="flex w-64 shrink-0 flex-col border-r border-border">
    <div class="flex border-b border-border text-xs">
      <button
        class="flex-1 py-2 transition-colors"
        :class="tab === 'chats' ? 'text-foreground bg-secondary/40' : 'text-muted-foreground'"
        @click="tab = 'chats'"
      >
        对话
      </button>
      <button
        class="flex-1 py-2 transition-colors"
        :class="tab === 'folders' ? 'text-foreground bg-secondary/40' : 'text-muted-foreground'"
        @click="tab = 'folders'"
      >
        收藏夹
      </button>
    </div>

    <!-- 对话 -->
    <div v-if="tab === 'chats'" class="flex min-h-0 flex-1 flex-col">
      <div class="space-y-1 p-2">
        <button
          class="flex w-full items-center gap-1 rounded px-1.5 py-1 text-xs text-primary hover:bg-secondary/40"
          @click="emit('newChat')"
        >
          <Plus class="h-3 w-3" /> 新建空对话
        </button>
        <button
          v-if="activeAwemeId"
          class="flex w-full items-center gap-1 rounded px-1.5 py-1 text-xs text-primary hover:bg-secondary/40"
          @click="emit('newChatFromNote')"
        >
          <Plus class="h-3 w-3" /> 从当前笔记新建
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <button
          v-for="s in sessions"
          :key="s.id"
          class="group block w-full border-b border-border/50 px-3 py-2 text-left hover:bg-secondary/40"
          :class="s.id === activeSessionId ? 'bg-secondary/60' : ''"
          @click="emit('openChat', s.id)"
        >
          <div class="flex items-start gap-1">
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs">{{ s.title }}</div>
              <div class="truncate text-[11px] text-muted-foreground">
                {{ s.videoName || '未钉笔记' }}
              </div>
            </div>
            <span
              class="hidden shrink-0 text-muted-foreground group-hover:block"
              title="删除这场对话"
              @click.stop="emit('deleteChat', s.id)"
            >
              <Trash2 class="h-3 w-3" />
            </span>
          </div>
        </button>
        <p v-if="!sessions.length" class="p-3 text-xs leading-relaxed text-muted-foreground">
          还没有对话。先在「收藏夹」里打开一篇笔记，再点「新建对话」。
        </p>
      </div>
    </div>

    <!-- 收藏夹 -->
    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div class="space-y-1 p-2">
        <input
          v-model="q"
          class="w-full rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs outline-none"
          placeholder="筛选标题"
        />
        <button
          class="flex items-center gap-1 text-xs text-primary disabled:opacity-50"
          :disabled="loading"
          @click="emit('refresh')"
        >
          <RefreshCw class="h-3 w-3" :class="loading ? 'animate-spin' : ''" />
          {{ loading ? '正在读转写服务…' : '刷新' }}
        </button>
      </div>
      <p v-if="error" class="px-2 pb-2 text-[11px] leading-relaxed text-destructive">{{ error }}</p>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div v-for="[name, list] in groups" :key="name" class="text-xs">
          <button
            class="flex w-full items-center gap-1 px-3 py-1.5 text-left font-medium hover:bg-secondary/30"
            @click="toggle(name)"
          >
            <FolderOpen class="h-3 w-3 shrink-0 text-muted-foreground" />
            <span class="truncate">{{ closed[name] ? '▸' : '▾' }} {{ name }}</span>
            <span class="ml-auto shrink-0 text-muted-foreground">{{ list.length }}</span>
          </button>
          <div v-if="!closed[name]">
            <button
              v-for="it in list"
              :key="name + it.aweme_id"
              class="block w-full truncate py-1.5 pl-7 pr-2 text-left hover:bg-secondary/40"
              :class="activeAwemeId === it.aweme_id ? 'bg-secondary/60 text-foreground' : 'text-muted-foreground'"
              @click="emit('openItem', it)"
            >
              {{ it.title }}
            </button>
          </div>
        </div>
        <p v-if="!groups.length && !error" class="p-3 leading-relaxed text-muted-foreground">
          {{ q ? '没有匹配的标题。' : '还没有转写好的笔记。去转写服务里跑几条。' }}
        </p>
      </div>
    </div>

    <button
      class="flex items-center gap-2 border-t border-border px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
      @click="$router.push({ name: 'settings' })"
    >
      <Settings class="h-3.5 w-3.5" /> 设置
    </button>
  </aside>
</template>
