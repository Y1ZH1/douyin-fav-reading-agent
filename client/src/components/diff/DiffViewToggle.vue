<script setup lang="ts">
import type { DiffViewMode } from '@/types/diff'
import { AlignJustify, Columns2 } from 'lucide-vue-next'

defineProps<{ mode: DiffViewMode }>()
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <div class="flex items-center bg-secondary/30 rounded-lg border border-border p-0.5">
    <button
      :class="['flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors',
        mode === 'unified' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground']"
      @click="mode === 'split' ? emit('toggle') : undefined"
    >
      <AlignJustify class="h-3.5 w-3.5" />
      统一视图
    </button>
    <button
      :class="['flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors',
        mode === 'split' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground']"
      @click="mode === 'unified' ? emit('toggle') : undefined"
    >
      <Columns2 class="h-3.5 w-3.5" />
      分栏视图
    </button>
  </div>
</template>
