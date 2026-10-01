<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useChat } from '@/composables/useChat'
import {
  MessageSquare,
  Plus,
  Trash2,
  Code2,
  PanelLeftClose,
  PanelLeft,
  Settings,
  Pin,
} from 'lucide-vue-next'

defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const router = useRouter()
const route = useRoute()

const { sessions, activeSessionId, switchSession, createSession, deleteSession, togglePinSession } = useChat()

const sortedSessions = computed(() =>
  [...sessions.value].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt - a.updatedAt
  }),
)

function handleNewSession() {
  createSession()
  if (route.name !== 'home') {
    router.push({ name: 'home' })
  }
}

function handleDeleteSession(id: string, event: Event) {
  event.stopPropagation()
  deleteSession(id)
}

function handleSwitchSession(id: string) {
  switchSession(id)
  if (route.name !== 'home') {
    router.push({ name: 'home' })
  }
}

function navigateTo(routeName: string) {
  router.push({ name: routeName })
}
</script>

<template>
  <aside
    :class="[
      'flex flex-col h-full bg-background border-r border-border transition-all duration-200',
      collapsed ? 'w-[52px]' : 'w-[260px]',
    ]"
  >
    <div class="flex items-center justify-between px-3 py-3 border-b border-border">
      <div v-if="!collapsed" class="flex items-center gap-2">
        <div class="flex h-6 w-6 items-center justify-center rounded bg-primary/20">
          <Code2 class="h-3.5 w-3.5 text-primary" />
        </div>
        <span class="text-sm font-semibold text-foreground tracking-tight">收藏 Agent</span>
      </div>
      <button
        class="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        @click="emit('toggle')"
      >
        <PanelLeftClose v-if="!collapsed" class="h-4 w-4" />
        <PanelLeft v-else class="h-4 w-4" />
      </button>
    </div>

    <!-- New Session -->
    <div class="px-2 py-2">
      <button
        class="flex items-center gap-2 w-full rounded-lg px-2 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        :class="{ 'justify-center': collapsed }"
        @click="handleNewSession"
      >
        <Plus class="h-4 w-4 shrink-0" />
        <span v-if="!collapsed" class="truncate">新对话</span>
      </button>
    </div>

    <!-- Navigation -->
    <div class="px-2 pb-1">
      <div v-if="!collapsed" class="px-2 py-1.5">
        <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">页面</span>
      </div>
      <button
        class="flex items-center gap-2 w-full rounded-lg px-2 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
        :class="{ 'justify-center': collapsed }"
        @click="navigateTo('home')"
      >
        <MessageSquare class="h-4 w-4 shrink-0" />
        <span v-if="!collapsed">阅读 Agent</span>
      </button>
    </div>

    <!-- Session List -->
    <div class="flex-1 overflow-y-auto px-2 pb-2">
      <div v-if="!collapsed" class="px-2 py-1.5">
        <span class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">最近</span>
      </div>
      <div class="space-y-0.5">
        <button
          v-for="session in sortedSessions"
          :key="session.id"
          :class="[
            'group flex items-center gap-2 w-full rounded-lg px-2 py-2 text-sm transition-colors text-left',
            session.id === activeSessionId
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/30',
            collapsed ? 'justify-center' : '',
          ]"
          @click="handleSwitchSession(session.id)"
        >
          <MessageSquare class="h-4 w-4 shrink-0" />
          <span v-if="!collapsed" class="truncate flex-1 text-xs">
            {{ session.title }}
            <Pin v-if="session.pinned" class="h-2.5 w-2.5 inline ml-1 text-muted-foreground/50" />
          </span>
          <button
            v-if="!collapsed"
            class="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-secondary/80"
            title="固定会话"
            @click="(e: Event) => { e.stopPropagation(); togglePinSession(session.id) }"
          >
            <Pin class="h-3 w-3 text-muted-foreground hover:text-foreground" />
          </button>
          <button
            v-if="!collapsed"
            class="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-secondary/80"
            @click="(e: Event) => handleDeleteSession(session.id, e)"
          >
            <Trash2 class="h-3 w-3 text-muted-foreground hover:text-destructive" />
          </button>
        </button>
      </div>
    </div>

    <div v-if="!collapsed" class="border-t border-border">
      <button
        class="flex items-center gap-2 w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
        @click="navigateTo('settings')"
      >
        <Settings class="h-3.5 w-3.5" />
        设置
      </button>
      <p class="px-3 py-2 text-[10px] text-muted-foreground/40 text-center">
        收藏阅读 Agent
      </p>
    </div>
  </aside>
</template>
