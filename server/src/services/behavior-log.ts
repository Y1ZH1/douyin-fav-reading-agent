/**
 * 行为日志 → memory.md「编译」。
 *
 * 为什么要有这一层：memory.md 现在只有两条写入路径 —— 用户说「记住 …」，
 * 或者去设置页手改。也就是说 Agent 其实没有「从行为里学习惯」的能力，
 * 面试上会被问穿。这里补上：每次划线解释 / 入笔记 / 分类 / 检索 / 记忆请求
 * 都往 append-only 的 JSONL 里记一条，再把这些原始事件聚合成一份
 * **memory.md 草稿**。
 *
 * 三条硬约束（对齐 docs/specs/reading-agent-ia.md）：
 *  1. 日志**不进笔记库**。笔记库只放转写和确认后的写入，所以日志落在
 *     服务端自己的 .state/ 下。
 *  2. 编译产物只是**草稿**。函数返回文本，落地必须走用户确认（HITL）。
 *     编译函数自己永远不写 memory.md。
 *  3. 日志是 append-only，写坏了不影响功能（读日志失败按空处理）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type BehaviorKind =
  | 'highlight_explain'
  | 'highlight_summarize'
  | 'add_note'
  | 'classify'
  | 'retrieve'
  | 'pin'
  | 'memory_request'

export interface BehaviorEvent {
  ts: number
  kind: BehaviorKind
  videoId?: string
  folder?: string
  action?: string
  confidence?: number
  suggested?: string
  quoteHead?: string
  prompt?: string
  query?: string
  hits?: number
  pinned?: string[]
  text?: string
}

const MAX_BYTES = Number(process.env.AGENT_LOG_MAX_BYTES || 4 * 1024 * 1024)

/** 路径每次现算：单测里改 AGENT_STATE_DIR 就能立刻换位置，不用重载模块。 */
function stateDir(): string {
  return resolve(process.env.AGENT_STATE_DIR || join(process.cwd(), '.state'))
}

export function logPath(): string {
  return join(stateDir(), 'behavior-log.jsonl')
}

function ensureDir() {
  const dir = stateDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function appendBehavior(event: Omit<BehaviorEvent, 'ts'> & { ts?: number }): BehaviorEvent {
  const full: BehaviorEvent = { ts: event.ts ?? Date.now(), ...event } as BehaviorEvent
  try {
    ensureDir()
    const path = logPath()
    // 超限就轮转一次，避免这个文件无限长（日志不值得占空间）
    if (existsSync(path)) {
      try {
        const size = readFileSync(path).length
        if (size > MAX_BYTES) writeFileSync(path, '', 'utf8')
      } catch {
        /* 忽略 */
      }
    }
    appendFileSync(path, JSON.stringify(full) + '\n', 'utf8')
  } catch {
    // 日志失败绝不该影响主流程
  }
  return full
}

export function readBehavior(limit = 500, kind?: BehaviorKind): BehaviorEvent[] {
  const path = logPath()
  if (!existsSync(path)) return []
  let lines: string[] = []
  try {
    lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
  const picked = kind ? lines.filter((l) => safeParse(l)?.kind === kind) : lines
  return picked
    .slice(-Math.max(1, limit))
    .map((l) => safeParse(l))
    .filter((x): x is BehaviorEvent => !!x)
}

/** 清空日志。只影响 memory 编译的依据，不碰任何笔记与已写入的 memory.md。 */
export function clearBehavior(): void {
  try {
    ensureDir()
    writeFileSync(logPath(), '', 'utf8')
  } catch {
    /* 忽略 */
  }
}

function safeParse(line: string): BehaviorEvent | null {
  try {
    const v = JSON.parse(line)
    return v && typeof v === 'object' ? (v as BehaviorEvent) : null
  } catch {
    return null
  }
}

export function behaviorStats(events: BehaviorEvent[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of events) out[e.kind] = (out[e.kind] || 0) + 1
  out.total = events.length
  return out
}

/* ------------------------------------------------------------ 编译成草稿 */

export interface CompileResult {
  draft: string
  added: string[]
  stats: Record<string, number>
  since: number | null
}

const HABIT_HEADER = '## 从行为里学到的（待确认）'
const QUERY_STOP = new Set([
  '这个', '那个', '怎么', '什么', '为什么', '如何', '可以', '是不是', '有没有',
  '一下', '帮我', '看看', '找找', '里面', '里找', '库里', '笔记', '视频',
])

function topWords(texts: string[], n = 3, min = 2): string[] {
  const counter = new Map<string, number>()
  for (const t of texts) {
    const tokens = String(t || '')
      .split(/[\s，。！？、；：,.!?;:()（）[\]【】"“”'']+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 8 && !QUERY_STOP.has(s) && !/^\d+$/.test(s))
    for (const tk of new Set(tokens)) counter.set(tk, (counter.get(tk) || 0) + 1)
  }
  return [...counter.entries()]
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([w, c]) => `${w}(${c})`)
}

/**
 * 把日志聚合成 memory.md 草稿。
 *
 * 规则刻意保守 —— 只有「重复出现」的行为才算习惯，单次行为不写进去，
 * 免得 memory 变成流水账，反而污染每一次 system prompt。
 */
export function compileMemory(
  currentText: string,
  events: BehaviorEvent[],
  sinceHours = 24 * 14,
): CompileResult {
  const cutoff = Date.now() - sinceHours * 3600 * 1000
  const recent = events.filter((e) => (e.ts || 0) >= cutoff)
  const added: string[] = []

  // 1) 分类习惯：同一目标夹被接受 >= 2 次
  const folderHits = new Map<string, { n: number; auto: number }>()
  for (const e of recent) {
    if (e.kind !== 'classify' || !e.folder || e.action === 'skip') continue
    const rec = folderHits.get(e.folder) || { n: 0, auto: 0 }
    rec.n += 1
    if (e.action === 'auto') rec.auto += 1
    folderHits.set(e.folder, rec)
  }
  const folders = [...folderHits.entries()].filter(([, v]) => v.n >= 2)
  if (folders.length) {
    const list = folders
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 5)
      .map(([name, v]) => `「${name}」×${v.n}`)
      .join('、')
    added.push(`- 分类习惯：讲这些主题的内容你倾向放进 ${list}`)
  }

  // 2) 解释偏好：用户自定义提示词里反复出现的词
  const prompts = recent.filter((e) => e.kind === 'highlight_explain' && e.prompt).map((e) => e.prompt!)
  const words = topWords(prompts)
  if (words.length) added.push(`- 解释偏好：你的提示词里反复出现 ${words.join('、')}`)

  // 3) 常查主题
  const queries = recent.filter((e) => e.kind === 'retrieve' && e.query).map((e) => e.query!)
  if (queries.length >= 3) {
    const qw = topWords(queries, 4, 2)
    if (qw.length) added.push(`- 常查主题：${qw.join('、')}（共 ${queries.length} 次检索）`)
  }

  // 4) 使用强度（一句话就够，别啰嗦）
  const explains = recent.filter((e) => e.kind === 'highlight_explain').length
  const notes = recent.filter((e) => e.kind === 'add_note').length
  const pins = recent.filter((e) => e.kind === 'pin').length
  if (explains + notes + pins >= 5) {
    added.push(`- 使用节奏：最近 ${sinceHours / 24} 天，划线解释 ${explains} 次、入笔记 ${notes} 次、钉笔记 ${pins} 次`)
  }

  // 5) 用户显式说「记住」的，原样收进来（并去重）
  const requests = recent
    .filter((e) => e.kind === 'memory_request' && e.text)
    .map((e) => `- ${String(e.text).trim()}`)
  for (const r of requests) {
    const bare = r.slice(2)
    if (bare && !currentText.includes(bare) && !added.includes(r)) added.push(r)
  }

  const stamp = new Date().toISOString().slice(0, 10)
  const block = added.length
    ? `\n${HABIT_HEADER}\n\n_（${stamp} 由行为日志编译，共 ${recent.length} 条行为；确认后才会写入）_\n\n${added.join('\n')}\n`
    : ''
  const base = stripCompiled(currentText).trimEnd()

  return {
    draft: (base + block + (block ? '' : '\n')).replace(/\n{4,}/g, '\n\n\n'),
    added,
    stats: behaviorStats(recent),
    since: recent.length ? Math.min(...recent.map((e) => e.ts)) : null,
  }
}

/** 去掉上一次编译出来的块，避免每编译一次就叠加一层。 */
export function stripCompiled(text: string): string {
  const idx = text.indexOf(HABIT_HEADER)
  if (idx < 0) return text
  const next = text.indexOf('\n## ', idx + 1)
  return next < 0 ? text.slice(0, idx) : text.slice(0, idx) + text.slice(next + 1)
}
