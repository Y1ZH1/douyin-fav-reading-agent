<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useUIStore } from '@/stores/ui';
import { BookOpen, Search, Settings } from 'lucide-vue-next';

const router = useRouter();
const uiStore = useUIStore();
const search = ref('');
const selectedIndex = ref(0);

// 旧代码导师的三个入口（代码差异 / 代码分析 / 个人简介）已经从产品主路径退役，
// 源码按产品规格保留，但不该再出现在命令面板里。
const commands = [
  {
    id: 'reading',
    label: '阅读 Agent',
    description: '对着转写做划线、追问、入笔记、分类',
    icon: BookOpen,
    action: () => router.push('/'),
  },
  {
    id: 'settings',
    label: '设置',
    description: '划线提示词、memory.md、检索与向量',
    icon: Settings,
    action: () => router.push('/settings'),
  },
];

const filtered = computed(() => {
  if (!search.value.trim()) return commands;
  const q = search.value.toLowerCase();
  return commands.filter(
    (c) => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q),
  );
});

function executeCommand(cmd: (typeof commands)[0]) {
  cmd.action();
  uiStore.commandPaletteOpen = false;
  search.value = '';
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex.value = Math.min(selectedIndex.value + 1, filtered.value.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (filtered.value[selectedIndex.value]) {
      executeCommand(filtered.value[selectedIndex.value]);
    }
  } else if (e.key === 'Escape') {
    uiStore.commandPaletteOpen = false;
  }
}

function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    uiStore.toggleCommandPalette();
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKeydown));
onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="uiStore.commandPaletteOpen"
      class="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh]"
    >
      <div
        class="fixed inset-0 bg-black/50 backdrop-blur-sm"
        @click="uiStore.commandPaletteOpen = false"
      />
      <div
        class="relative w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
      >
        <div class="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search class="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            v-model="search"
            placeholder="输入命令或搜索..."
            class="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            autofocus
            @keydown="onKeydown"
          />
          <kbd class="text-[10px] text-muted-foreground/50 bg-secondary/50 px-1.5 py-0.5 rounded"
            >ESC</kbd
          >
        </div>
        <div class="max-h-[300px] overflow-y-auto py-1">
          <button
            v-for="(cmd, idx) in filtered"
            :key="cmd.id"
            :class="[
              'flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors',
              idx === selectedIndex
                ? 'bg-secondary/50 text-foreground'
                : 'text-muted-foreground hover:bg-secondary/30',
            ]"
            @click="executeCommand(cmd)"
            @mouseenter="selectedIndex = idx"
          >
            <component :is="cmd.icon" class="h-4 w-4 shrink-0" />
            <div>
              <div class="text-sm">{{ cmd.label }}</div>
              <div class="text-[10px] text-muted-foreground/70">{{ cmd.description }}</div>
            </div>
          </button>
          <div
            v-if="filtered.length === 0"
            class="px-4 py-6 text-center text-sm text-muted-foreground"
          >
            未找到命令
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
