<script setup lang="ts">
import { computed } from 'vue'
import type { DiffLine, WordChange } from '@/types/diff'

const props = defineProps<{ line: DiffLine }>()

const lineClass = computed(() => {
  switch (props.line.type) {
    case 'add': return 'diff-add'
    case 'delete': return 'diff-delete'
    case 'header': return 'bg-secondary/30 text-muted-foreground text-xs font-medium'
    default: return ''
  }
})

const marker = computed(() => {
  switch (props.line.type) {
    case 'add': return '+'
    case 'delete': return '-'
    default: return ' '
  }
})

const markerClass = computed(() => {
  switch (props.line.type) {
    case 'add': return 'text-green-400'
    case 'delete': return 'text-red-400'
    default: return 'text-muted-foreground'
  }
})

/** 词级差异渲染：根据行类型过滤 wordChanges，只显示该行相关的部分 */
const wordSpans = computed(() => {
  if (!props.line.wordChanges) return null
  return props.line.wordChanges
    .filter((w: WordChange) => {
      // delete 行只显示 equal + delete（跳过 add）
      if (props.line.type === 'delete') return w.type !== 'add'
      // add 行只显示 equal + add（跳过 delete）
      if (props.line.type === 'add') return w.type !== 'delete'
      // context 行直接显示全部（但不应该出现 wordChanges）
      return true
    })
    .map((w: WordChange) => ({
      text: w.text,
      cls: w.type === 'add'
        ? 'bg-green-500/20 text-green-300 rounded-sm'
        : w.type === 'delete'
          ? 'bg-red-500/20 text-red-300 rounded-sm'
          : '',
    }))
})

const showWordDiff = computed(() => props.line.wordChanges && wordSpans.value && wordSpans.value.length > 0)
</script>

<template>
  <div :class="['flex font-mono text-sm leading-6 min-h-[24px]', lineClass]">
    <div class="flex items-center justify-end w-10 shrink-0 select-none text-xs text-muted-foreground/50 px-2 border-r border-border/50">
      {{ line.oldLineNumber || '' }}
    </div>
    <div class="flex items-center justify-end w-10 shrink-0 select-none text-xs text-muted-foreground/50 px-2 border-r border-border/50">
      {{ line.newLineNumber || '' }}
    </div>
    <div :class="['w-5 shrink-0 text-center select-none', markerClass]">
      {{ marker }}
    </div>
    <div class="flex-1 px-3 whitespace-pre-wrap break-all text-foreground/90">
      <template v-if="showWordDiff">
        <span
          v-for="(part, idx) in wordSpans"
          :key="idx"
          :class="part.cls"
        >{{ part.text }}</span>
      </template>
      <template v-else>
        {{ line.content }}
      </template>
    </div>
  </div>
</template>
