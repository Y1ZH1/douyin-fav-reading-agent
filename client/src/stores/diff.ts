import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { DiffFile, DiffViewMode, AIExplanation } from '@/types/diff'
import { buildDiff } from '@/services/parser/diff-parser'
import { streamDiffExplanation } from '@/services/ai'
import { validateAIExplanation } from '@/services/parser/json-validator'
import { extractJSONFromMarkdown } from '@/services/parser/json-validator'

export const useDiffStore = defineStore('diff', () => {
  const diffFile = ref<DiffFile | null>(null)
  const viewMode = ref<DiffViewMode>('unified')
  const isExplaining = ref(false)
  const explanation = ref<AIExplanation | null>(null)
  const expandedHunks = ref<Set<string>>(new Set())
  const oldCode = ref('')
  const newCode = ref('')
  const language = ref('text')

  const hasChanges = computed(() => {
    if (!diffFile.value) return false
    return diffFile.value.stats.additions > 0 || diffFile.value.stats.deletions > 0
  })

  function computeDiff(oldCodeStr: string, newCodeStr: string, lang?: string) {
    oldCode.value = oldCodeStr
    newCode.value = newCodeStr
    language.value = lang || 'text'
    diffFile.value = buildDiff(oldCodeStr, newCodeStr, language.value)
    explanation.value = null
    expandedHunks.value = new Set()
  }

  function toggleHunk(hunkId: string) {
    if (expandedHunks.value.has(hunkId)) {
      expandedHunks.value.delete(hunkId)
    } else {
      expandedHunks.value.add(hunkId)
    }
  }

  function toggleViewMode() {
    viewMode.value = viewMode.value === 'unified' ? 'split' : 'unified'
  }

  async function fetchExplanation(signal?: AbortSignal) {
    if (!oldCode.value || !newCode.value) return
    isExplaining.value = true
    explanation.value = null

    // 传递真实的 hunk ID 给后端，以便 AI 在其 JSON 响应中引用它们
    const hunkIds = diffFile.value?.hunks.map((h) => ({
      id: h.id,
      oldStart: h.oldStart,
      newStart: h.newStart,
    }))

    let fullContent = ''
    try {
      for await (const chunk of streamDiffExplanation(
        oldCode.value,
        newCode.value,
        language.value || undefined,
        signal,
        hunkIds,
      )) {
        if (chunk.content) fullContent += chunk.content
      }

      const json = extractJSONFromMarkdown(fullContent)
      if (json) {
        const result = validateAIExplanation(json)
        if (result.success && result.data) {
          explanation.value = result.data
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    } finally {
      isExplaining.value = false
    }
  }

  function clear() {
    diffFile.value = null
    explanation.value = null
    oldCode.value = ''
    newCode.value = ''
  }

  return {
    diffFile,
    viewMode,
    isExplaining,
    explanation,
    expandedHunks,
    oldCode,
    newCode,
    language,
    hasChanges,
    computeDiff,
    toggleHunk,
    toggleViewMode,
    fetchExplanation,
    clear,
  }
})
