<script setup lang="ts">
import { toRef, ref, watch, onMounted, nextTick, computed } from 'vue'
import { useMarkdown } from '@/composables/useMarkdown'
import { useSettingsStore } from '@/stores/settings'
import { storeToRefs } from 'pinia'

const props = defineProps<{ content: string }>()

const settingsStore = useSettingsStore()
const { settings } = storeToRefs(settingsStore)

const theme = computed(() => settings.value.theme)

const { html, loading } = useMarkdown(toRef(props, 'content'), theme)

const containerRef = ref<HTMLDivElement>()

let mermaidReady = false
let mermaidInstance: typeof import('mermaid').default | null = null
let lastMermaidTheme: string | null = null

async function ensureMermaid() {
  const currentTheme = theme.value
  if (mermaidReady && mermaidInstance && lastMermaidTheme === currentTheme) return mermaidInstance
  const mod = await import('mermaid')
  mermaidInstance = mod.default
  const isDark = currentTheme === 'dark'
  mermaidInstance.initialize({
    theme: isDark ? 'dark' : 'default',
    startOnLoad: false,
    themeVariables: isDark ? {
      primaryColor: '#3b82f6',
      primaryTextColor: '#e5e7eb',
      lineColor: '#6b7280',
      secondaryColor: '#1f2937',
      tertiaryColor: '#111827',
    } : {
      primaryColor: '#3b82f6',
      primaryTextColor: '#1f2937',
      lineColor: '#9ca3af',
      secondaryColor: '#f3f4f6',
      tertiaryColor: '#ffffff',
    },
  })
  mermaidReady = true
  lastMermaidTheme = currentTheme
  return mermaidInstance
}

async function renderMermaidBlocks() {
  if (!containerRef.value) return
  const mermaidEls = containerRef.value.querySelectorAll<HTMLElement>('.mermaid-container')
  if (mermaidEls.length === 0) return
  const mermaid = await ensureMermaid()
  if (!mermaid) return
  for (const el of mermaidEls) {
    const encoded = el.dataset.mermaid
    if (!encoded) continue
    const code = decodeURIComponent(encoded)
    try {
      const { svg } = await mermaid.render(`mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, code)
      el.innerHTML = svg
      el.classList.remove('mermaid-container')
    } catch {
      el.innerHTML = `<span class="text-xs text-destructive">Mermaid 渲染错误</span>`
    }
  }
}

watch(html, async () => {
  await nextTick()
  renderMermaidBlocks()
})

onMounted(async () => {
  await nextTick()
  renderMermaidBlocks()
})
</script>

<template>
  <div v-if="loading && !content" class="animate-pulse space-y-2">
    <div class="h-4 bg-secondary/50 rounded w-3/4" />
    <div class="h-4 bg-secondary/30 rounded w-1/2" />
    <div class="h-4 bg-secondary/30 rounded w-2/3" />
  </div>
  <div
    v-else
    ref="containerRef"
    class="prose prose-sm max-w-none
      prose-headings:text-foreground prose-headings:font-semibold
      prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
      prose-p:text-foreground/85 prose-p:leading-relaxed
      prose-li:text-foreground/85
      prose-code:text-primary prose-code:bg-secondary/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
      prose-pre:p-0 prose-pre:bg-transparent prose-pre:border-0
      prose-strong:text-foreground
      prose-a:text-primary hover:prose-a:text-primary/80
      prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground prose-blockquote:bg-secondary/20 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg
      prose-table:border-border
      prose-th:bg-secondary/50 prose-th:text-foreground prose-th:px-3 prose-th:py-2
      prose-td:px-3 prose-td:py-2 prose-td:border-border
      [&_table]:overflow-hidden [&_table]:rounded-lg [&_table]:border [&_table]:border-border
    "
    :class="{ 'prose-invert': theme === 'dark' }"
    v-html="html"
  />
</template>
