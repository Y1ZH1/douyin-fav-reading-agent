import type { Ref } from 'vue'
import { ref, watch } from 'vue'
import type MarkdownIt from 'markdown-it'

let mdInstance: MarkdownIt | null = null
let mdInitPromise: Promise<MarkdownIt> | null = null
let currentShikiTheme: 'github-dark' | 'github-light' = 'github-dark'

async function getMarkdownInstance(): Promise<MarkdownIt> {
  if (mdInstance) return mdInstance
  if (mdInitPromise) return mdInitPromise

  mdInitPromise = (async () => {
    const [
      { default: MarkdownIt },
      { default: container },
      { default: katexPlugin },
      { default: attrs },
      { useCodeHighlight },
    ] = await Promise.all([
      import('markdown-it'),
      import('markdown-it-container'),
      import('markdown-it-katex'),
      import('markdown-it-attrs'),
      import('./useCodeHighlight'),
    ])

    const { getHighlighter, initHighlighter } = useCodeHighlight()
    await initHighlighter()

    const instance = new MarkdownIt({
      html: false,
      linkify: true,
      typographer: true,
      breaks: true,
    })

    instance.use(katexPlugin, { throwOnError: false, errorColor: '#ff6b6b' })

    instance.use(container, 'diff', {
      validate: (name: string) => name === 'diff',
      render: (tokens: { nesting: number }[], idx: number) => {
        if (tokens[idx].nesting === 1) {
          return '<div class="diff-block my-4 rounded-lg border border-border overflow-hidden">\n'
        }
        return '</div>\n'
      },
    })

    instance.use(container, 'details', {
      validate: (name: string) => name === 'details',
      render: (tokens: { nesting: number; info: string }[], idx: number) => {
        if (tokens[idx].nesting === 1) {
          const summary = tokens[idx].info.trim() || 'Details'
          return `<details class="code-details my-4 rounded-lg border border-border bg-card"><summary class="px-4 py-2 cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">${instance.utils.escapeHtml(summary)}</summary><div class="px-4 pb-4">\n`
        }
        return '</div></details>\n'
      },
    })

    const defaultFence = instance.renderer.rules.fence!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    instance.renderer.rules.fence = (tokens: any[], idx: number, options: any, env: any, self: any) => {
      const token = tokens[idx]
      const info = token.info?.trim() || ''
      const code = token.content

      if (info === 'mermaid') {
        return `<div class="mermaid-container my-4" data-mermaid="${encodeURIComponent(code)}"></div>`
      }

      const isFocus = info.endsWith('.focus')
      const lang = isFocus ? info.replace('.focus', '') : info

      if (lang) {
        try {
          const highlighter = getHighlighter()
          if (highlighter) {
            const html = highlighter.codeToHtml(code, { lang, theme: currentShikiTheme })
            return `<div class="code-block-wrapper${isFocus ? ' code-focus' : ''}">
              <div class="code-block-header">
                <span class="code-block-lang">${lang}</span>
                <button class="copy-btn text-xs text-muted-foreground hover:text-foreground transition-colors" data-code="${escapeAttr(code)}">
                  Copy
                </button>
              </div>
              <div class="overflow-x-auto">${html}</div>
            </div>`
          }
        } catch {
          // Fallback
        }
      }
      return defaultFence(tokens, idx, options, env, self)
    }

    instance.use(attrs)

    mdInstance = instance
    return instance
  })()

  return mdInitPromise
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Web Worker 渲染 + Shiki 后处理 ──

let workerImportCache: { renderInWorker: (c: string) => Promise<string>; terminateWorker?: () => void } | null = null

async function getWorkerApi() {
  if (workerImportCache) return workerImportCache
  workerImportCache = await import('./useWorkerMarkdown')
  return workerImportCache
}

/** 后处理 Worker 输出的 HTML：查找普通代码块并用 Shiki 高亮 */
async function postProcessWithShiki(html: string): Promise<string> {
  const { useCodeHighlight } = await import('./useCodeHighlight')
  const { highlightCode } = useCodeHighlight()
  const { initHighlighter } = useCodeHighlight()
  await initHighlighter()

  // 查找所有 <pre><code class="language-xxx"> 代码块
  const codeBlockRegex = /<pre><code class="language-(\w+)">([\s\S]*?)<\/code><\/pre>/g
  const matches: Array<{ full: string; lang: string; code: string }> = []
  let match: RegExpExecArray | null
  while ((match = codeBlockRegex.exec(html)) !== null) {
    matches.push({ full: match[0], lang: match[1], code: match[2] })
  }

  // 依次替换每个代码块（支持异步 highlightCode）
  let result = html
  for (const m of matches) {
    try {
      const decoded = m.code
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
      const highlighted = await highlightCode(decoded, m.lang, currentShikiTheme)
      result = result.replace(m.full, highlighted)
    } catch {
      // 高亮失败时保留原始内容
    }
  }
  return result
}

export function useMarkdown(content: Ref<string>, theme?: Ref<'dark' | 'light'>) {
  const html = ref('')
  const loading = ref(true)

  // 保持模块级主题与传入的 ref 同步
  if (theme) {
    watch(theme, (t) => {
      currentShikiTheme = t === 'dark' ? 'github-dark' : 'github-light'
    }, { immediate: true })
  }

  // 使用 watch 替代 watchEffect — 异步 watchEffect 仅在第一个 await 前同步访问依赖。
  // 由于 content.value 在 await getMarkdownInstance() 之后才读取，
  // 流式传输中的内容变化从未触发重新渲染（HTML 停留在初始空字符串渲染，导致 AI 回复显示为空白）。
  watch(
    content,
    async (newContent) => {
      if (!newContent) return
      loading.value = true
      try {
        // 优先尝试 Worker 渲染（非阻塞，保持 UI 响应）
        const { renderInWorker } = await getWorkerApi()
        const rawHtml = await renderInWorker(newContent)
        // 后处理：在主线程上对代码块应用 Shiki 高亮
        html.value = await postProcessWithShiki(rawHtml)
      } catch {
        // Worker 失败 → 回退到主线程渲染（内置 Shiki）
        try {
          const md = await getMarkdownInstance()
          html.value = md.render(newContent)
        } catch {
          // 如果渲染失败，保留之前的内容以避免空白
        }
      }
      loading.value = false
    },
    { immediate: true },
  )

  return { html, loading }
}

export async function renderMarkdownOnce(content: string, theme?: 'dark' | 'light'): Promise<string> {
  const prevTheme = currentShikiTheme
  if (theme) {
    currentShikiTheme = theme === 'dark' ? 'github-dark' : 'github-light'
  }

  let result: string
  try {
    const { renderInWorker } = await getWorkerApi()
    const rawHtml = await renderInWorker(content)
    result = await postProcessWithShiki(rawHtml)
  } catch {
    const md = await getMarkdownInstance()
    result = md.render(content)
  }

  if (theme) {
    currentShikiTheme = prevTheme
  }
  return result
}
