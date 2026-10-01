<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useSelectionExplain } from '@/composables/useSelectionExplain'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
import { Loader2, X, Sparkles, GripHorizontal } from 'lucide-vue-next'

const {
  selectionPos,
  showButton,
  explanation,
  isStreaming,
  isVisible,
  error,
  explainSelection,
  hideExplanation,
} = useSelectionExplain()

const panelOffset = ref({ x: 0, y: 0 })

const panelPos = computed(() => ({
  x: Math.min(selectionPos.value.x + panelOffset.value.x, window.innerWidth - 340),
  y: Math.max(selectionPos.value.y + panelOffset.value.y, 8),
}))

// 拖拽状态
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })

function onDragStart(e: MouseEvent) {
  isDragging.value = true
  dragStart.value = { x: e.clientX - panelOffset.value.x, y: e.clientY - panelOffset.value.y }
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
  e.preventDefault()
}

function onDragMove(e: MouseEvent) {
  if (!isDragging.value) return
  panelOffset.value = {
    x: e.clientX - dragStart.value.x,
    y: e.clientY - dragStart.value.y,
  }
}

function onDragEnd() {
  isDragging.value = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

function handleClose() {
  panelOffset.value = { x: 0, y: 0 }
  hideExplanation()
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})
</script>

<template>
  <!-- 选中内容附近的浮动操作按钮 -->
  <Transition name="fade">
    <button
      v-if="showButton && !isVisible"
      class="fixed z-50 flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
      :style="{ left: `${selectionPos.x}px`, top: `${selectionPos.y}px`, transform: 'translateX(-50%)' }"
      @click.stop="explainSelection"
    >
      <Sparkles class="h-3 w-3" />
      解释选中内容
    </button>
  </Transition>

  <!-- 解释提示框 -->
  <Transition name="fade">
    <div
      v-if="isVisible"
      class="fixed z-50 w-80"
      :class="{ 'cursor-grabbing select-none': isDragging }"
      :style="{ left: `${panelPos.x}px`, top: `${panelPos.y}px` }"
    >
      <div class="rounded-lg border border-border bg-card shadow-xl">
        <!-- 拖拽手柄 + 标题栏 -->
        <div
          class="flex items-center justify-between px-3 py-2 border-b border-border cursor-grab active:cursor-grabbing select-none rounded-t-lg bg-secondary/30"
          @mousedown="onDragStart"
        >
          <div class="flex items-center gap-2">
            <GripHorizontal class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="text-xs font-medium text-muted-foreground">AI 解释</span>
          </div>
          <button
            class="flex items-center justify-center h-5 w-5 rounded hover:bg-secondary/50 transition-colors"
            @click.stop="handleClose"
          >
            <X class="h-3 w-3 text-muted-foreground" />
          </button>
        </div>

        <!-- 内容区域 -->
        <div class="p-3">
          <div v-if="error" class="text-xs text-destructive">
            {{ error }}
          </div>

          <div v-else-if="isStreaming || explanation" class="text-xs leading-relaxed max-h-[300px] overflow-y-auto">
            <MarkdownRenderer v-if="explanation" :content="explanation" />
            <span v-if="isStreaming" class="typing-cursor inline-block w-0.5 h-3 bg-primary animate-pulse align-text-bottom ml-0.5" />
          </div>

          <div v-else class="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 class="h-3 w-3 animate-spin" />
            加载中...
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
