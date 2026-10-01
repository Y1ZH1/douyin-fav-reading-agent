import type { Highlighter } from 'shiki'
import { LRUCache } from '@/lib/lru-cache'

let highlighterPromise: Promise<Highlighter> | null = null
let highlighterInstance: Highlighter | null = null
const highlightCache = new LRUCache<string>(200)

// 核心语言 — 预先加载（最常用）
const CORE_LANGS = ['typescript', 'javascript', 'python', 'html', 'css', 'json', 'bash']
// 扩展语言 — 按需加载
const EXTENDED_LANGS = [
  'vue', 'tsx', 'jsx', 'sql', 'yaml', 'markdown', 'rust', 'go', 'java',
  'c', 'cpp', 'csharp', 'php', 'ruby', 'swift', 'kotlin', 'scala', 'graphql',
]
const ALL_LANGS = [...CORE_LANGS, ...EXTENDED_LANGS]
const loadedLangs = new Set<string>()

export function useCodeHighlight() {
  function getHighlighter(): Highlighter | null {
    return highlighterInstance
  }

  async function initHighlighter(): Promise<Highlighter> {
    if (highlighterInstance) return highlighterInstance
    if (!highlighterPromise) {
      highlighterPromise = (async () => {
        // 动态导入 — shiki 仅在真正需要代码高亮时加载
        const { createHighlighter } = await import('shiki')
        const hl = await createHighlighter({
          themes: ['github-dark', 'github-light'],
          langs: CORE_LANGS,
        })
        for (const lang of CORE_LANGS) loadedLangs.add(lang)
        return hl
      })()
    }
    highlighterInstance = await highlighterPromise
    return highlighterInstance
  }

  /** 确保特定语言的语法已加载（按需） */
  async function ensureLang(lang: string): Promise<void> {
    const normalized = lang.toLowerCase()
    if (loadedLangs.has(normalized) || !ALL_LANGS.includes(normalized)) return
    const hl = await initHighlighter()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await hl.loadLanguage(normalized as any)
      loadedLangs.add(normalized)
    } catch {
      // 语言不可用 — 回退到纯文本渲染
    }
  }

  async function highlightCode(code: string, lang: string, theme: 'github-dark' | 'github-light' = 'github-dark'): Promise<string> {
    const cacheKey = `${theme}:${lang}:${code.slice(0, 200)}:${code.length}`
    const cached = highlightCache.get(cacheKey)
    if (cached) return cached

    await ensureLang(lang)
    const hl = await initHighlighter()
    const result = hl.codeToHtml(code, { lang, theme })
    highlightCache.set(cacheKey, result)
    return result
  }

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  return { getHighlighter, initHighlighter, highlightCode, escapeHtml }
}

export function getSupportedLanguages(): string[] {
  return [...ALL_LANGS]
}
