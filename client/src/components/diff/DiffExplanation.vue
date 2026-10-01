<script setup lang="ts">
import type { AIExplanation } from '@/types/diff'
import { Info, AlertTriangle, AlertCircle, Sparkles, Loader2 } from 'lucide-vue-next'

defineProps<{
  explanation: AIExplanation | null
  isLoading: boolean
}>()

const severityIcon = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertCircle,
}

const severityClass = {
  info: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  warning: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
  critical: 'text-red-400 bg-red-400/10 border-red-400/20',
}
</script>

<template>
  <div class="diff-explanation rounded-lg border border-border bg-card overflow-hidden">
    <div class="flex items-center gap-2 px-4 py-3 border-b border-border">
      <Sparkles class="h-4 w-4 text-primary" />
      <span class="text-sm font-medium text-foreground">AI 解释</span>
      <Loader2 v-if="isLoading" class="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />
    </div>

    <div v-if="isLoading && !explanation" class="px-4 py-6 space-y-3">
      <div class="h-4 bg-secondary/30 rounded w-2/3 animate-pulse" />
      <div class="h-3 bg-secondary/20 rounded w-full animate-pulse" />
      <div class="h-3 bg-secondary/20 rounded w-4/5 animate-pulse" />
    </div>

    <template v-if="explanation">
      <div class="px-4 py-3 border-b border-border/50">
        <p class="text-sm text-foreground/85">{{ explanation.summary }}</p>
      </div>
      <div class="divide-y divide-border/50">
        <div
          v-for="section in explanation.sections"
          :key="section.hunkId"
          class="px-4 py-3"
        >
          <div class="flex items-start gap-2">
            <component :is="severityIcon[section.severity]" :class="['h-4 w-4 mt-0.5 shrink-0', severityClass[section.severity].split(' ')[0]]" />
            <div class="flex-1 min-w-0">
              <h4 class="text-sm font-medium text-foreground mb-1">{{ section.title }}</h4>
              <p class="text-xs text-muted-foreground leading-relaxed">{{ section.detail }}</p>
              <div v-if="section.learningPoints?.length" class="flex flex-wrap gap-1.5 mt-2">
                <span
                  v-for="point in section.learningPoints"
                  :key="point"
                  class="text-[10px] px-1.5 py-0.5 rounded bg-secondary/50 text-muted-foreground"
                >
                  {{ point }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
