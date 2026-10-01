import { ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { streamAnalyze } from '@/services/ai'

export interface CodeFile {
  id: string
  name: string
  content: string
}

export function useExplanation() {
  const store = useChatStore()
  const isExplaining = ref(false)
  const explanationContent = ref('')
  const error = ref<string | null>(null)

  async function analyzeCode(
    files: CodeFile[],
    modes: string[],
    language?: string,
  ): Promise<void> {
    const nonEmptyFiles = files.filter((f) => f.content.trim())
    if (nonEmptyFiles.length === 0 || isExplaining.value) return
    if (modes.length === 0) return

    error.value = null
    isExplaining.value = true
    explanationContent.value = ''

    let fullContent = ''
    let reasoningBuffer = ''
    let hasContent = false
    try {
      for await (const chunk of streamAnalyze(nonEmptyFiles, modes, language)) {
        if (chunk.reasoning && !hasContent) {
          reasoningBuffer += chunk.reasoning
          explanationContent.value = `> 🧠 思考中...\n\n${reasoningBuffer}`
        }
        if (chunk.content) {
          if (!hasContent) {
            hasContent = true
            explanationContent.value = ''
          }
          fullContent += chunk.content
          explanationContent.value = fullContent
        }
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '分析失败'
    } finally {
      isExplaining.value = false
    }
  }

  async function explainAndChat(code: string, language?: string) {
    const prompt = language
      ? `Please explain the following ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``
      : `Please explain the following code:\n\n\`\`\`\n${code}\n\`\`\``

    store.addMessage('user', prompt)
  }

  function resetExplanation() {
    explanationContent.value = ''
    error.value = null
    isExplaining.value = false
  }

  return {
    isExplaining,
    explanationContent,
    error,
    analyzeCode,
    explainAndChat,
    resetExplanation,
  }
}
