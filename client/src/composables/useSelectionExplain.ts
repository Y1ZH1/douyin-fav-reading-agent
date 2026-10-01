import { ref, onMounted, onUnmounted } from 'vue'
import { streamExplanation } from '@/services/ai'

// 共享状态，使 App.vue 和 SelectionTooltip 使用同一实例
const selectedText = ref('')
const selectionPos = ref({ x: 0, y: 0 })
const showButton = ref(false)
const explanation = ref('')
const isStreaming = ref(false)
const isVisible = ref(false)
const error = ref<string | null>(null)
const selectionContext = ref('')

let abortController: AbortController | null = null
let listenerAttached = false

export function useSelectionExplain() {
  function onMouseUp() {
    setTimeout(() => {
      // 不要干扰已有的解释
      if (isVisible.value) return

      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        hideButton()
        return
      }

      const text = sel.toString().trim()
      if (text.length < 2 || text.length > 500) {
        hideButton()
        return
      }

      selectedText.value = text

      // 捕获周围的上下文
      try {
        const range = sel.getRangeAt(0)
        const container = range.commonAncestorContainer
        const parentEl = container.nodeType === Node.TEXT_NODE
          ? container.parentElement
          : container instanceof Element ? container : container.parentElement

        if (parentEl) {
          const fullText = parentEl.textContent || ''
          const selStart = fullText.indexOf(text)
          if (selStart !== -1) {
            const before = fullText.slice(Math.max(0, selStart - 100), selStart)
            const after = fullText.slice(selStart + text.length, selStart + text.length + 100)
            selectionContext.value = `${before}【${text}】${after}`
          } else {
            selectionContext.value = text
          }
        } else {
          selectionContext.value = text
        }
      } catch {
        selectionContext.value = text
      }

      const rect = sel.getRangeAt(0).getBoundingClientRect()
      selectionPos.value = {
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
      }
      showButton.value = true
    }, 50)
  }

  // 只挂载一次全局监听器
  if (!listenerAttached) {
    listenerAttached = true
    onMounted(() => document.addEventListener('mouseup', onMouseUp))
    onUnmounted(() => document.removeEventListener('mouseup', onMouseUp))
  }

  function hideButton() {
    showButton.value = false
    selectedText.value = ''
  }

  function getUILanguage(): 'zh' | 'en' {
    try {
      const raw = localStorage.getItem('ai-code-tutor-settings')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.language === 'en') return 'en'
      }
    } catch { /* 解析失败时默认使用中文 */ }
    return 'zh'
  }

  async function explainSelection() {
    if (!selectedText.value || isStreaming.value) return

    showButton.value = false
    isVisible.value = true
    isStreaming.value = true
    error.value = null
    explanation.value = ''

    abortController?.abort()
    const controller = new AbortController()
    abortController = controller

    const lang = getUILanguage()
    const prompt = selectionContext.value
      ? lang === 'en'
        ? `Explain the selected text in context:\n\nContext:\n${selectionContext.value}\n\nFocus on the text in 【】.`
        : `请结合上下文解释以下选中的内容:\n\n上下文:\n${selectionContext.value}\n\n请重点关注【】中选中的内容。`
      : lang === 'en'
        ? `Explain the following selected text:\n\n${selectedText.value}`
        : `解释以下选中的内容:\n\n${selectedText.value}`

    let hasContent = false
    try {
      for await (const chunk of streamExplanation(
        prompt,
        undefined,
        controller.signal,
      )) {
        if (chunk.reasoning && !hasContent) {
          explanation.value = `> 🧠 思考中...\n\n` + explanation.value + chunk.reasoning
        }
        if (chunk.content) {
          if (!hasContent) {
            hasContent = true
            explanation.value = ''
          }
          explanation.value += chunk.content
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      error.value = e instanceof Error ? e.message : '请求失败'
    } finally {
      isStreaming.value = false
    }
  }

  function hideExplanation() {
    abortController?.abort()
    isVisible.value = false
    explanation.value = ''
    error.value = null
  }

  return {
    selectedText,
    selectionPos,
    showButton,
    explanation,
    isStreaming,
    isVisible,
    error,
    onMouseUp,
    hideButton,
    explainSelection,
    hideExplanation,
  }
}
