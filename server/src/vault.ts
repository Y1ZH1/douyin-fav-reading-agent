import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  highlightsDeco,
  parseHighlights,
  rematch,
  splitFrontmatter,
  upsertHighlight,
  writeHighlights,
  type Highlight,
} from './highlights.js'

const FLASK = process.env.DOUYIN_FLASK_URL || 'http://127.0.0.1:8899'

/**
 * 调 Flask。形状由调用方用泛型声明 —— 这里只保证「拿到的是 JSON」。
 * 失败时抛出带 `code` 的错误，前端据此显示「转写服务没开」这类人话。
 */
export async function flaskJson<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${FLASK}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers || {}) },
  })
  const text = await res.text()
  let parsed: unknown = {}
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { error: text.slice(0, 200) }
  }
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  if (!res.ok) {
    const err = new Error(String(obj.error || `Flask ${res.status}`)) as Error & {
      code?: string
      status?: number
    }
    err.code = String(obj.code || 'WorkerUnreachable')
    err.status = res.status
    throw err
  }
  return parsed as T
}

/** 转写服务（Flask :8899）是否活着。健康横幅与启动自检都靠它。 */
export async function flaskAlive(timeoutMs = 1500): Promise<{ ok: boolean; error?: string; dir?: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const data = await flaskJson<{ dir?: string }>('/api/obsidian-dir', { signal: ctrl.signal })
    return { ok: true, dir: String(data.dir || '') }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

let vaultRootCache: string | null = null

export async function vaultRoot(): Promise<string> {
  if (process.env.DOUYIN_OBSIDIAN_DIR) {
    vaultRootCache = resolve(process.env.DOUYIN_OBSIDIAN_DIR)
    return vaultRootCache
  }
  const data = await flaskJson<{ dir?: string }>('/api/obsidian-dir')
  vaultRootCache = resolve(String(data.dir))
  return vaultRootCache
}

export function assertInsideVault(root: string, filePath: string): string {
  const rootAbs = resolve(root)
  const abs = resolve(filePath)
  const rel = relative(rootAbs, abs)
  const escaped = !rel || isAbsolute(rel) || rel.split(/[/\\]/).includes('..')
  if (escaped && abs.toLowerCase() !== rootAbs.toLowerCase()) {
    const err = new Error('非法路径：只能写入笔记库目录') as Error & { code?: string }
    err.code = 'PathEscape'
    throw err
  }
  return abs
}

export function parseFrontMatter(text: string): { meta: Record<string, string>; body: string; rawFm: string } {
  const { inner, body } = splitFrontmatter(text)
  if (!inner) return { meta: {}, body: text, rawFm: '' }
  const meta: Record<string, string> = {}
  const aid = inner.match(/aweme_id:\s*"([^"]*)"/)
  if (aid) meta.aweme_id = aid[1]
  return { meta, body, rawFm: inner }
}

/**
 * 追加一条划线。落库格式是 frontmatter 的 `highlights:` 块
 * （见 highlights.ts），不是正文里的裸引用 —— 重转写覆盖正文时高亮才不会丢。
 */
export function upsertHighlights(text: string, highlight: Record<string, unknown>): string {
  const quote = String(highlight.quote || '')
  return upsertHighlight(text, quote, {
    id: typeof highlight.id === 'string' ? highlight.id : undefined,
    start: typeof highlight.start === 'number' ? highlight.start : undefined,
    end: typeof highlight.end === 'number' ? highlight.end : undefined,
  }).text
}

export function readNoteText(abs: string): { path: string; text: string; highlights: ReturnType<typeof highlightsDeco> } {
  const text = readFileSync(abs, 'utf8')
  return { path: abs, text, highlights: highlightsDeco(text) }
}

export function rematchNote(abs: string): { stats: ReturnType<typeof rematch>['stats']; highlights: ReturnType<typeof highlightsDeco> } {
  const text = readFileSync(abs, 'utf8')
  const items = parseHighlights(text)
  if (!items.length) return { stats: { total: 0, ok: 0, moved: 0, stale: 0, duplicate: 0 }, highlights: highlightsDeco(text) }
  const { body } = splitFrontmatter(text)
  const { items: rematched, stats } = rematch(items, body)
  writeFileSync(abs, writeHighlights(text, rematched), 'utf8')
  return { stats, highlights: highlightsDeco(readFileSync(abs, 'utf8')) }
}

export interface VaultNote {
  path: string
  relPath: string
  title: string
  awemeId: string
  folders: string[]
  highlights: number
  stale: number
}

/** 只读文件开头若干字节。用于列表/打分这类不需要全文的场景。 */
export function readHead(abs: string, bytes = 16 * 1024): string {
  try {
    const fd = openSync(abs, 'r')
    const buf = Buffer.alloc(bytes)
    const n = readSync(fd, buf, 0, bytes, 0)
    closeSync(fd)
    return buf.subarray(0, n).toString('utf8')
  } catch {
    return ''
  }
}

/* ------------------------------------------- 按 aweme_id 找笔记（走快路径） */

/**
 * aweme_id → 笔记路径的索引，带 15 秒 TTL。
 *
 * 为什么需要它：Agent 每轮对话最多会钉 4 篇笔记，每篇都要「按 aweme_id
 * 找文件」。如果每次都 rglob 全库 + 读全文，179 篇的库会变成几百次
 * 文件读，一次对话就能卡住几秒。
 *
 * 所以这里只读每个文件的开头 2KB（frontmatter 一定在这段里），
 * 并且缓存一份索引。新转写的笔记最迟 15 秒后可见，够用。
 */
const ID_INDEX_TTL_MS = 15_000
let idIndex: { builtAt: number; root: string; map: Map<string, string> } | null = null
const HEAD_BYTES = 2048

function buildIdIndex(root: string): Map<string, string> {
  const map = new Map<string, string>()
  const walk = (dir: string, depth = 0) => {
    if (depth > 6) return
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const abs = join(dir, name)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(abs, depth + 1)
        continue
      }
      if (!/\.md$/i.test(name) || name.toLowerCase() === 'memory.md') continue
      try {
        // 只读开头：不为了一个 id 把整篇转写读进来
        const fd = openSync(abs, 'r')
        const buf = Buffer.alloc(HEAD_BYTES)
        const n = readSync(fd, buf, 0, HEAD_BYTES, 0)
        closeSync(fd)
        const m = /aweme_id:\s*"([^"]+)"/.exec(buf.subarray(0, n).toString('utf8'))
        if (m) map.set(m[1], abs)
      } catch {
        continue
      }
    }
  }
  walk(root)
  return map
}

export function findNoteByAwemeId(root: string, awemeId: string): string | null {
  if (!awemeId) return null
  const now = Date.now()
  if (!idIndex || idIndex.root !== root || now - idIndex.builtAt > ID_INDEX_TTL_MS) {
    idIndex = { builtAt: now, root, map: buildIdIndex(root) }
  }
  const hit = idIndex.map.get(awemeId)
  if (hit && existsSync(hit)) return hit
  return null
}

/** 只数文件不读内容，给健康检查用。 */
export function countVaultNotes(root: string): number {
  let n = 0
  const walk = (dir: string, depth = 0) => {
    if (depth > 6) return
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const abs = join(dir, name)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(abs, depth + 1)
      else if (/\.md$/i.test(name) && name.toLowerCase() !== 'memory.md') n += 1
    }
  }
  walk(root)
  return n
}

/**
 * 直接从磁盘列笔记库（不经过 Flask）。
 * 用途：Flask 没开时的候选提案、以及给 Agent 一个「库里到底有什么」的视图。
 * 注意它会读每个文件的正文，是显式操作（设置页 / notes 接口）才调，
 * 不要放进热路径。
 */
export function listVaultNotes(root: string, limit = 500): VaultNote[] {
  const out: VaultNote[] = []
  const walk = (dir: string) => {
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const abs = join(dir, name)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(abs)
        continue
      }
      if (!name.toLowerCase().endsWith('.md') || name.toLowerCase() === 'memory.md') continue
      if (out.length >= limit) return
      // 只读开头：列表/打分不需要整篇转写，179 篇的库全量读会明显卡
      const text = readHead(abs)
      if (!text) continue
      const items = parseHighlights(text)
      const { body } = splitFrontmatter(text)
      const aid = text.match(/aweme_id:\s*"([^"]*)"/)
      const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim()
      out.push({
        path: abs,
        relPath: relative(root, abs),
        title: title || name.replace(/\.md$/i, ''),
        awemeId: aid?.[1] || '',
        folders: [],
        highlights: items.length,
        stale: items.filter((h: Highlight) => h.status === 'stale').length,
      })
    }
  }
  walk(root)
  return out
}

export function appendNote(absPath: string, chunk: string) {
  const dir = dirname(absPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const prev = existsSync(absPath) ? readFileSync(absPath, 'utf8') : ''
  writeFileSync(absPath, prev + chunk, 'utf8')
}

export function readMemory(root: string): { path: string; text: string } {
  const p = join(root, 'memory.md')
  if (!existsSync(p)) {
    const seed = `# memory.md\n\n- 追问偏好: 先给要点再举例\n- 解释风格: 简体中文，短句\n`
    writeFileSync(p, seed, 'utf8')
    return { path: p, text: seed }
  }
  return { path: p, text: readFileSync(p, 'utf8') }
}

export function writeMemory(root: string, text: string) {
  const p = join(root, 'memory.md')
  writeFileSync(p, text, 'utf8')
  return p
}
