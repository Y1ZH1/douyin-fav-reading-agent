/**
 * 划线（高亮）的落库格式与「重转写后的 stale 重匹配」。
 *
 * 与 douyin-fav-transcribe/highlights.py 是同一套规则的两种实现：
 * 格式不一致会让「Python 写的笔记 Node 读不懂」，所以两边的
 * YAML 片段格式、指纹长度（32 字）、匹配规则顺序必须逐字对齐。
 * 改动这里时，同步改 Python 侧并跑两端单测。
 */

export const FINGERPRINT = 32
export const BLOCK_KEY = 'highlights'

export interface Highlight {
  id: string
  quote: string
  prefix: string
  suffix: string
  start: number
  end: number
  status: 'ok' | 'stale'
  created?: string
}

export interface RematchStats {
  total: number
  ok: number
  moved: number
  stale: number
  duplicate: number
}

/* ------------------------------------------------------------ frontmatter */

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/

export function splitFrontmatter(text: string): { inner: string; body: string; nl: string } {
  if (!text.startsWith('---')) return { inner: '', body: text, nl: '\n' }
  const nl = text.slice(0, 200).includes('\r\n') ? '\r\n' : '\n'
  const m = /^---\r?\n/.exec(text)
  if (!m) return { inner: '', body: text, nl }
  const rest = text.slice(m[0].length)
  const end = /^(---|-{3,})\s*$/m.exec(rest)
  if (!end) return { inner: '', body: text, nl }
  const inner = rest.slice(0, end.index).replace(/\n+$/, '')
  const body = rest.slice(end.index + end[0].length).replace(/^\r?\n+/, '')
  return { inner, body, nl }
}

export function joinFrontmatter(inner: string, body: string, nl = '\n'): string {
  if (!inner.trim()) return body
  return `---${nl}${inner}${nl}---${nl}${nl}${body}`
}

/* -------------------------------------------------- 归一化空白 + 下标映射 */

/**
 * 两种归一化都要，因为中文和西文对「折行」的期望相反：
 *  keepSpace=true  连续空白折成一个空格 → "hello\nworld" 匹配 "hello world"
 *  keepSpace=false 空白全去掉          → "怎么\n在" 匹配正文里的 "怎么在"
 * 只用一种，另一类摘录就会假性 stale。
 */
export function collapse(s: string, keepSpace = true): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let prevSpace = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (/\s/.test(ch)) {
      if (!keepSpace || prevSpace || !text) continue
      text += ' '
      map.push(i)
      prevSpace = true
    } else {
      text += ch
      map.push(i)
      prevSpace = false
    }
  }
  return { text, map }
}

function variants(body: string) {
  return [collapse(body, true), collapse(body, false)]
}

/** 找出 needle 在 body 里的所有归一化命中（原文坐标）。 */
export function findAll(body: string, needle: string, vs = variants(body)): Array<[number, number]> {
  if (!needle) return []
  const found: Array<[number, number]> = []
  for (const keepSpace of [true, false]) {
    const { text, map } = keepSpace ? vs[0] : vs[1]
    const n = collapse(needle, keepSpace).text
    if (!n) continue
    let pos = text.indexOf(n)
    while (pos >= 0) {
      const lo = map[pos]
      const hi = map[pos + n.length - 1] + 1
      if (!found.some(([a, b]) => a === lo && b === hi)) found.push([lo, hi])
      pos = text.indexOf(n, pos + 1)
    }
  }
  return found
}

/* ---------------------------------------------------------------- YAML 片段 */

function quoteYaml(value: string): string {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function unquoteYaml(raw: string): string {
  let s = raw.trim()
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    s = s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return s
}

export function serializeHighlights(items: Highlight[]): string {
  if (!items.length) return `${BLOCK_KEY}: []`
  const lines = [`${BLOCK_KEY}:`]
  for (const h of items) {
    lines.push(`  - id: ${quoteYaml(h.id || '')}`)
    lines.push(`    quote: ${quoteYaml(h.quote || '')}`)
    lines.push(`    prefix: ${quoteYaml(h.prefix || '')}`)
    lines.push(`    suffix: ${quoteYaml(h.suffix || '')}`)
    lines.push(`    start: ${Number.isFinite(h.start) ? h.start : -1}`)
    lines.push(`    end: ${Number.isFinite(h.end) ? h.end : -1}`)
    lines.push(`    status: ${h.status || 'ok'}`)
    if (h.created) lines.push(`    created: ${quoteYaml(h.created)}`)
  }
  return lines.join('\n')
}

export function parseHighlights(text: string): Highlight[] {
  const { inner } = splitFrontmatter(text)
  if (!inner) return []
  const raw: Array<Record<string, string>> = []
  let cur: Record<string, string> | null = null
  let inBlock = false
  for (const line of inner.split(/\r?\n/)) {
    if (!inBlock) {
      const head = KEY_LINE.exec(line)
      if (head && head[1] === BLOCK_KEY) inBlock = true
      continue
    }
    if (!line.trim()) continue
    if (!/^[ \t]/.test(line)) {
      inBlock = false
      continue
    }
    const stripped = line.trim()
    if (stripped.startsWith('- ')) {
      if (cur) raw.push(cur)
      cur = {}
      const kv = KEY_LINE.exec(stripped.slice(2))
      if (kv) cur[kv[1]] = unquoteYaml(kv[2])
      continue
    }
    const kv = KEY_LINE.exec(stripped)
    if (kv && cur) cur[kv[1]] = unquoteYaml(kv[2])
  }
  if (cur) raw.push(cur)

  const out: Highlight[] = []
  for (const h of raw) {
    const quote = (h.quote || '').trim()
    if (!quote) continue
    const start = Number.parseInt(h.start ?? '', 10)
    const end = Number.parseInt(h.end ?? '', 10)
    out.push({
      id: h.id || newId(),
      quote,
      prefix: h.prefix || '',
      suffix: h.suffix || '',
      start: Number.isFinite(start) ? start : -1,
      end: Number.isFinite(end) ? end : -1,
      status: h.status === 'stale' ? 'stale' : 'ok',
      created: h.created || '',
    })
  }
  return out
}

function replaceBlock(inner: string, block: string): string {
  if (!inner.trim()) return block
  const lines = inner.split(/\r?\n/)
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const head = KEY_LINE.exec(lines[i])
    if (head && head[1] === BLOCK_KEY) {
      i++
      while (i < lines.length && (/^[ \t]/.test(lines[i]) || !lines[i].trim())) i++
      continue
    }
    out.push(lines[i])
    i++
  }
  const joined = out.join('\n').replace(/\n+$/, '')
  return joined ? `${joined}\n${block}` : block
}

export function writeHighlights(text: string, items: Highlight[]): string {
  const { inner, body, nl } = splitFrontmatter(text)
  return joinFrontmatter(replaceBlock(inner, serializeHighlights(items)), body, nl)
}

/* -------------------------------------------------------------------- 指纹 */

export function fingerprint(quote: string, char = FINGERPRINT): [string, string] {
  const flat = (quote || '').split(/\s+/).filter(Boolean).join(' ')
  return [flat.slice(0, char), flat.slice(-char)]
}

export function newId(): string {
  return `h-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

/** 由强到弱定位：前后指纹 → 单侧指纹 → 裸 quote。顺序不能改。 */
export function locate(
  h: Pick<Highlight, 'quote' | 'prefix' | 'suffix'>,
  body: string,
  taken: Array<[number, number]> = [],
): [number, number] | null {
  const quote = (h.quote || '').trim()
  if (!quote || !body) return null
  const prefix = (h.prefix || '').trim()
  const suffix = (h.suffix || '').trim()
  const candidates: string[] = []
  if (prefix && suffix) candidates.push(`${prefix} ${quote} ${suffix}`)
  if (prefix) candidates.push(`${prefix} ${quote}`)
  candidates.push(quote)
  if (suffix) candidates.push(`${quote} ${suffix}`)

  const vs = variants(body)
  for (const needle of candidates) {
    for (const span of findAll(body, needle, vs)) {
      if (!taken.some(([a, b]) => a === span[0] && b === span[1])) return span
    }
  }
  return null
}

export function makeHighlight(quote: string, body = '', extra: Partial<Highlight> = {}): Highlight {
  const flat = (quote || '').split(/\s+/).filter(Boolean).join(' ')
  const [prefix, suffix] = fingerprint(flat)
  const h: Highlight = {
    id: extra.id || newId(),
    quote: flat,
    prefix,
    suffix,
    start: typeof extra.start === 'number' ? extra.start : -1,
    end: typeof extra.end === 'number' ? extra.end : -1,
    status: 'ok',
    created: extra.created || new Date().toISOString(),
  }
  if (h.start < 0 && body) {
    const found = locate(h, body)
    if (found) [h.start, h.end] = found
  }
  if (h.start < 0 && body) h.status = 'stale'
  return h
}

export function rematch(items: Highlight[], body: string): { items: Highlight[]; stats: RematchStats } {
  const stats: RematchStats = { total: items.length, ok: 0, moved: 0, stale: 0, duplicate: 0 }
  const taken: Array<[number, number]> = []
  const out: Highlight[] = []
  for (const h of items) {
    const quote = (h.quote || '').trim()
    if (!quote) continue
    const [prefix, suffix] = fingerprint(quote)
    const item: Highlight = {
      id: h.id || newId(),
      quote: quote.split(/\s+/).filter(Boolean).join(' '),
      prefix,
      suffix,
      start: Number.isFinite(h.start) ? h.start : -1,
      end: Number.isFinite(h.end) ? h.end : -1,
      status: 'ok',
      created: h.created || '',
    }
    const oldStart = item.start
    const oldEnd = item.end
    if (oldStart >= 0 && oldEnd > oldStart && oldEnd <= body.length) {
      const chunk = body.slice(oldStart, oldEnd)
      const same =
        collapse(chunk, true).text === collapse(item.quote, true).text ||
        collapse(chunk, false).text === collapse(item.quote, false).text
      if (same) {
        if (taken.some(([a, b]) => a === oldStart && b === oldEnd)) {
          item.status = 'stale'
          stats.duplicate++
          stats.stale++
        } else {
          taken.push([oldStart, oldEnd])
          stats.ok++
        }
        out.push(item)
        continue
      }
    }
    const found = locate(item, body, taken)
    if (found) {
      ;[item.start, item.end] = found
      taken.push(found)
      stats.moved++
    } else {
      item.start = -1
      item.end = -1
      item.status = 'stale'
      stats.stale++
    }
    out.push(item)
  }
  return { items: out, stats }
}

/** 把一条摘录写进笔记正文。已存在相同 quote 时复用，不重复写。 */
export function upsertHighlight(
  text: string,
  quote: string,
  extra: Partial<Highlight> = {},
): { text: string; highlight: Highlight | null; stats: Record<string, number> } {
  const { inner, body, nl } = splitFrontmatter(text)
  const items = parseHighlights(text)
  const flat = (quote || '').split(/\s+/).filter(Boolean).join(' ')
  if (!flat) return { text, highlight: null, stats: { total: items.length, added: 0, reused: 0 } }
  const existing = items.find((h) => h.quote === flat)
  if (existing) return { text, highlight: existing, stats: { total: items.length, added: 0, reused: 1 } }
  const { items: rematched } = rematch(items, body)
  const hl = makeHighlight(flat, body, extra)
  rematched.push(hl)
  return {
    text: writeHighlights(joinFrontmatter(inner, body, nl), rematched),
    highlight: hl,
    stats: { total: rematched.length, added: 1, reused: 0 },
  }
}

export function highlightsDeco(text: string) {
  const items = parseHighlights(text)
  const byStatus: Record<string, number> = {}
  for (const h of items) byStatus[h.status] = (byStatus[h.status] || 0) + 1
  return { total: items.length, byStatus, items }
}
