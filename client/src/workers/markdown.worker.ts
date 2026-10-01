import MarkdownIt from 'markdown-it'
import container from 'markdown-it-container'
import katexPlugin from 'markdown-it-katex'
import attrs from 'markdown-it-attrs'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
})

md.use(katexPlugin, { throwOnError: false, errorColor: '#ff6b6b' })
md.use(container, 'diff', {
  validate: (name: string) => name === 'diff',
  render: (tokens: { nesting: number }[], idx: number) => {
    if (tokens[idx].nesting === 1) {
      return '<div class="diff-block my-4 rounded-lg border border-border overflow-hidden">\n'
    }
    return '</div>\n'
  },
})
md.use(container, 'details', {
  validate: (name: string) => name === 'details',
  render: (tokens: { nesting: number; info: string }[], idx: number) => {
    if (tokens[idx].nesting === 1) {
      const summary = tokens[idx].info.trim() || 'Details'
      return `<details class="code-details my-4 rounded-lg border border-border bg-card"><summary class="px-4 py-2 cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">${summary}</summary><div class="px-4 pb-4">\n`
    }
    return '</div></details>\n'
  },
})
md.use(attrs)

// Worker 没有 Shiki — 高亮在主线程渲染后完成
const defaultFence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const info = token.info?.trim() || ''
  const code = token.content

  if (info === 'mermaid') {
    return `<div class="mermaid-container my-4" data-mermaid="${encodeURIComponent(code)}"></div>`
  }

  const isFocus = info.endsWith('.focus')
  const lang = isFocus ? info.replace('.focus', '') : info

  if (lang) {
    return `<div class="code-block-wrapper${isFocus ? ' code-focus' : ''}">
      <div class="code-block-header">
        <span class="code-block-lang">${lang}</span>
        <button class="copy-btn text-xs text-muted-foreground hover:text-foreground transition-colors" data-code="${encodeURIComponent(code)}">
          Copy
        </button>
      </div>
      <div class="overflow-x-auto"><pre><code class="language-${lang}">${escapeHtmlWorker(code)}</code></pre></div>
    </div>`
  }
  return defaultFence(tokens, idx, options, env, self)
}

function escapeHtmlWorker(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

self.onmessage = (e: MessageEvent<{ id: string; content: string }>) => {
  const { id, content } = e.data
  const html = md.render(content)
  self.postMessage({ id, html })
}
