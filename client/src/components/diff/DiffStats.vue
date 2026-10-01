<script setup lang="ts">
import type { DiffStats as DiffStatsType } from '@/types/diff'
import { Plus, Minus, FileText } from 'lucide-vue-next'

defineProps<{ stats: DiffStatsType }>()
</script>

<template>
  <div class="flex items-center gap-3 text-xs">
      <span class="flex items-center gap-1 text-muted-foreground">
        <FileText class="h-3 w-3" />
        {{ stats.filesChanged }} 个文件
      </span>
    <span class="flex items-center gap-0.5 text-green-400 font-medium">
      <Plus class="h-3 w-3" />
      {{ stats.additions }}
    </span>
    <span class="flex items-center gap-0.5 text-red-400 font-medium">
      <Minus class="h-3 w-3" />
      {{ stats.deletions }}
    </span>
  </div>
</template>
