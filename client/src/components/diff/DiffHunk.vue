<script setup lang="ts">
import { computed } from 'vue'
import type { DiffHunk as DiffHunkType, DiffLine as DiffLineType, DiffViewMode } from '@/types/diff'
import DiffLine from './DiffLine.vue'
import DiffLineContent from './DiffLineContent.vue'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'

const props = defineProps<{
  hunk: DiffHunkType
  expanded: boolean
  viewMode: DiffViewMode
}>()

const emit = defineEmits<{ toggle: [] }>()

/** 将行列表配对，供 split 视图使用 */
const pairedLines = computed(() => {
  const pairs: Array<{ left: DiffLineType | null; right: DiffLineType | null }> = []
  const lines = props.hunk.lines
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const nextLine = lines[i + 1]
    if (line.type === 'delete' && nextLine?.type === 'add') {
      pairs.push({ left: line, right: nextLine })
      i += 2
    } else if (line.type === 'add' && i > 0 && lines[i - 1]?.type === 'delete') {
      i += 1
    } else {
      if (line.type === 'delete') {
        pairs.push({ left: line, right: null })
      } else if (line.type === 'add') {
        pairs.push({ left: null, right: line })
      } else {
        pairs.push({ left: line, right: line })
      }
      i += 1
    }
  }
  return pairs
})
</script>

<template>
  <div class="diff-hunk border-b border-border/50 last:border-b-0">
    <div
      class="flex items-center gap-2 px-4 py-1.5 bg-secondary/20 text-xs text-muted-foreground cursor-pointer hover:bg-secondary/30 transition-colors select-none"
      @click="emit('toggle')"
    >
      <ChevronDown v-if="expanded" class="h-3 w-3" />
      <ChevronRight v-else class="h-3 w-3" />
      <span>@@ -{{ hunk.oldStart }},{{ hunk.oldLines }} +{{ hunk.newStart }},{{ hunk.newLines }} @@</span>
    </div>

    <!-- Unified 视图 -->
    <div v-if="expanded && viewMode === 'unified'" class="hunk-lines">
      <DiffLine v-for="line in hunk.lines" :key="line.id" :line="line" />
    </div>

    <!-- Split 视图 -->
    <div v-if="expanded && viewMode === 'split'" class="hunk-lines">
      <div
        v-for="(pair, idx) in pairedLines"
        :key="idx"
        class="flex border-b border-border/20 last:border-b-0"
      >
        <!-- 左列：旧代码 -->
        <div class="w-1/2 min-w-0">
          <DiffLineContent
            v-if="pair.left"
            :line="pair.left"
          />
          <div v-else class="flex font-mono text-sm leading-6 min-h-[24px] bg-secondary/10">
            <div class="flex items-center justify-end w-10 shrink-0 select-none text-xs text-muted-foreground/50 px-2 border-r border-border/50">&nbsp;</div>
            <div class="flex items-center justify-end w-10 shrink-0 select-none text-xs text-muted-foreground/50 px-2 border-r border-border/50">&nbsp;</div>
            <div class="w-5 shrink-0 text-center select-none text-muted-foreground">&nbsp;</div>
            <div class="flex-1 px-3">&nbsp;</div>
          </div>
        </div>
        <!-- 右列：新代码 -->
        <div class="w-1/2 min-w-0 border-l border-border/40">
          <DiffLineContent
            v-if="pair.right"
            :line="pair.right"
          />
          <div v-else class="flex font-mono text-sm leading-6 min-h-[24px] bg-secondary/10">
            <div class="flex items-center justify-end w-10 shrink-0 select-none text-xs text-muted-foreground/50 px-2 border-r border-border/50">&nbsp;</div>
            <div class="flex items-center justify-end w-10 shrink-0 select-none text-xs text-muted-foreground/50 px-2 border-r border-border/50">&nbsp;</div>
            <div class="w-5 shrink-0 text-center select-none text-muted-foreground">&nbsp;</div>
            <div class="flex-1 px-3">&nbsp;</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
