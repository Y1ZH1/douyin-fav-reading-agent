<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useCodeHighlight } from '@/composables/useCodeHighlight'
import { useSettingsStore } from '@/stores/settings'
import { storeToRefs } from 'pinia'
import { Copy, Check } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    code: string
    language?: string
    showLineNumbers?: boolean
    showCopy?: boolean
  }>(),
  { language: 'text', showLineNumbers: true, showCopy: true },
)

const settingsStore = useSettingsStore()
const { settings } = storeToRefs(settingsStore)

const { highlightCode, initHighlighter } = useCodeHighlight()

const highlightedHtml = ref('')
const copied = ref(false)
const isReady = ref(false)

onMounted(async () => {
  await initHighlighter()
  isReady.value = true
  await updateHighlight()
})

watch(() => [props.code, props.language], updateHighlight)

async function updateHighlight() {
  if (!props.code) {
    highlightedHtml.value = ''
    return
  }
  try {
    const shikiTheme = settings.value.theme === 'dark' ? 'github-dark' : 'github-light'
    highlightedHtml.value = await highlightCode(props.code, props.language || 'text', shikiTheme)
  } catch {
    highlightedHtml.value = `<pre><code>${escapeHtml(props.code)}</code></pre>`
  }
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch { /* 降级处理 */ }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
</script>

<template>
  <div v-if="isReady && code" class="code-block-wrapper">
    <div class="code-block-header">
      <span class="code-block-lang">{{ language || 'text' }}</span>
      <button
        v-if="showCopy"
        class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-secondary/50"
        @click="copyCode"
      >
        <Check v-if="copied" class="h-3.5 w-3.5 text-green-400" />
        <Copy v-else class="h-3.5 w-3.5" />
        {{ copied ? '已复制' : '复制' }}
      </button>
    </div>
    <div
      class="overflow-x-auto text-sm leading-relaxed px-4 py-3"
      v-html="highlightedHtml"
    />
  </div>
  <div v-if="!isReady" class="code-block-wrapper p-4">
    <div class="h-20 animate-pulse bg-secondary/30 rounded" />
  </div>
</template>
