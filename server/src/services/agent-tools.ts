/**
 * Agent 的工具实现（纯逻辑，不含 SSE / 路由）。
 *
 * 拆出来的原因：agent.ts 只负责「状态机 + 事件」，工具的实现细节（怎么找笔记、
 * 怎么造候选、怎么打日志）放这里，两边各自都能保持可读、可测。
 *
 * 一条原则：**markdown 是源真相**。所以读笔记优先直接读磁盘，Flask 只是
 * 兜底和「列清单 / 改收藏夹」这类只有它才有的能力。Flask 没开时，
 * 阅读 + 划线 + 分类以外的功能不该整体瘫掉。
 */
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseHighlights } from '../highlights.js'
import {
  findNoteByAwemeId,
  flaskJson,
  listVaultNotes,
  readHead,
  rematchNote,
  type VaultNote,
} from '../vault.js'

export interface NotePayload {
  videoId: string
  path: string
  text: string
  body: string
  highlights: number
  stale: number
  source: 'disk' | 'flask'
}

export interface Candidate {
  awemeId: string
  title: string
  path: string
  folder: string
  span: string
  score: number
  via: string
  reason: string
}

/** 找一篇笔记：磁盘优先（源真相），Flask 兜底。 */
export async function getNote(root: string, videoId: string): Promise<NotePayload | null> {
  if (!videoId) return null
  // 走 aweme_id 快索引：只读每个文件的开头，不再全库读正文
  const abs = findNoteByAwemeId(root, videoId)
  if (abs) {
    try {
      const text = readFileSync(abs, 'utf8')
      return pack(videoId, abs, text, 'disk')
    } catch {
      /* 读不动就交给 Flask 兜底 */
    }
  }
  try {
    const data = await flaskJson<{ text?: string; path?: string }>(
      `/api/note?aweme_id=${encodeURIComponent(videoId)}`,
    )
    if (data?.text) return pack(videoId, String(data.path || ''), String(data.text), 'flask')
  } catch {
    /* Flask 没开，那就真的没有 */
  }
  return null
}

function pack(videoId: string, path: string, text: string, source: 'disk' | 'flask'): NotePayload {
  const items = parseHighlights(text)
  const body = text.startsWith('---') ? text.slice(text.indexOf('\n---', 3) + 4) : text
  return {
    videoId,
    path,
    text,
    body,
    highlights: items.length,
    stale: items.filter((h) => h.status === 'stale').length,
    source,
  }
}

/** 重转写后修一次划线定位。返回统计，供 Agent 如实汇报。 */
export function repairHighlights(path: string) {
  try {
    return rematchNote(path)
  } catch (e) {
    return { error: (e as Error).message }
  }
}

/** 摘要一条分类动作，写进行为日志。 */
export function classifyEvent(videoId: string | undefined, folder: string, action: string, extra: Record<string, unknown> = {}) {
  return {
    kind: 'classify' as const,
    videoId,
    folder,
    action,
    ...extra,
  }
}

/* --------------------------------------------------------------- 分类判定 */

export const JEV_DEFAULT_THRESHOLD = 0.72
export const JEV_DEFAULT_MIN_GAP = 0.08

/**
 * Jev 式分类：高置信自动写，低置信交给人。
 *
 * 两道门槛缺一不可 —— 光看置信度会让「0.75 vs 0.74」这种两夹胶着的情况
 * 被自动写错。所以还要求与第二名的间隙够宽。
 */
export function shouldAutoClassify(
  confidence: number,
  secondConfidence: number,
  threshold = JEV_DEFAULT_THRESHOLD,
  minGap = JEV_DEFAULT_MIN_GAP,
): { auto: boolean; reason: string } {
  const conf = Number(confidence) || 0
  const second = Number(secondConfidence) || 0
  const gap = conf - second
  if (conf < threshold) return { auto: false, reason: `置信度 ${conf.toFixed(2)} 低于阈值 ${threshold}` }
  if (gap < minGap) return { auto: false, reason: `与第二名只差 ${gap.toFixed(2)}，小于最小间隙 ${minGap}` }
  return { auto: true, reason: `置信度 ${conf.toFixed(2)}、间隙 ${gap.toFixed(2)}，都达标` }
}

/* --------------------------------------------------------------- 候选提案 */

const STOP = new Set(['这个', '那个', '怎么', '什么', '为什么', '如何', '帮我', '一下', '关于', '有关', '里面', '里找'])

function terms(query: string): string[] {
  return [...new Set(
    String(query || '')
      .split(/[\s，。！？、；：,.!?;:()（）[\]【】"“”'']+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && !STOP.has(s)),
  )].slice(0, 12)
}

function scoreText(text: string, ts: string[]): number {
  const low = text.toLowerCase()
  let hit = 0
  for (const t of ts) if (low.includes(t.toLowerCase())) hit += 1
  return hit
}

/**
 * Flask 检索不可用时的本地兜底：直接在笔记库上做词面命中。
 * 结果会标 `via: 'local'`，前端要如实显示「这是本地粗筛，不是全文索引」。
 *
 * 只读文件开头 12KB —— 打分和取片段都够用，全量读会让 179 篇的库
 * 在每次降级时都卡一下。
 */
export function localCandidates(root: string, query: string, limit = 8): Candidate[] {
  const ts = terms(query)
  if (!ts.length) return []
  const notes: VaultNote[] = listVaultNotes(root, 400)
  const scored: Array<{ n: VaultNote; s: number; span: string }> = []
  for (const n of notes) {
    const text = readHead(n.path, 12 * 1024)
    if (!text) continue
    const s = scoreText(text, ts) + scoreText(n.title, ts) * 2
    if (s <= 0) continue
    scored.push({ n, s, span: pickSpan(text, ts) })
  }
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, limit).map(({ n, s, span }) => ({
    awemeId: n.awemeId,
    title: n.title,
    path: n.path,
    folder: '',
    span,
    score: s,
    via: 'local',
    reason: `本地词面命中 ${s} 处（Flask 检索未启用的退路）`,
  }))
}

function pickSpan(text: string, ts: string[]): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 8)
  for (const line of lines) {
    if (ts.some((t) => line.includes(t))) return line.trim().slice(0, 120)
  }
  return lines[0]?.trim().slice(0, 120) || ''
}

interface RawHit {
  aweme_id?: string
  title?: string
  path?: string
  folder?: string
  span?: string
  score?: number
  via?: string
}

/** 调 Flask 全文/向量检索，拿回候选。 */
export async function remoteCandidates(
  query: string,
  videoId?: string,
  folderId?: string,
  limit = 8,
): Promise<Candidate[]> {
  const data = await flaskJson<{ hits?: RawHit[] }>('/api/retrieve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, k: limit, videoId, folderId }),
  })
  const hits = data.hits || []
  return hits.map((h) => {
    const score = Number(h.score) || 0
    const scoped = score >= 2 ? '这条视频本身' : score >= 1.5 ? '同收藏夹' : '全库'
    const via = h.via === 'vector' ? '向量' : '全文索引'
    return {
      awemeId: String(h.aweme_id || ''),
      title: String(h.title || ''),
      path: String(h.path || ''),
      folder: String(h.folder || ''),
      span: String(h.span || ''),
      score,
      via: String(h.via || 'fts'),
      reason: `${via}命中 · 范围：${scoped}`,
    }
  })
}

/** 统一入口：先 Flask，失败退回本地粗筛。绝不编造，空就是空。 */
export async function findCandidates(
  root: string,
  query: string,
  videoId?: string,
  folderId?: string,
  limit = 8,
): Promise<{ items: Candidate[]; via: 'flask' | 'local'; error?: string }> {
  try {
    const items = await remoteCandidates(query, videoId, folderId, limit)
    return { items, via: 'flask' }
  } catch (e) {
    const items = localCandidates(root, query, limit)
    return { items, via: 'local', error: (e as Error).message }
  }
}

/** 收藏夹列表（只有 Flask 有）。 */
export async function folderNames(): Promise<string[]> {
  const res = await flaskJson<{ folders?: unknown; items?: unknown }>('/api/folders')
  const raw = res.folders || res.items || []
  if (!Array.isArray(raw)) return []
  return raw
    .map((f) => (typeof f === 'string' ? f : ((f as { name?: string; id?: string }).name || (f as { id?: string }).id || '')))
    .filter(Boolean)
}

export function noteTitleOf(path: string, text: string): string {
  const t = /^#\s+(.+)$/m.exec(text)?.[1]?.trim()
  return t || basename(path).replace(/\.md$/i, '') || path
}

export function memoryPathOf(root: string): string {
  return join(root, 'memory.md')
}
