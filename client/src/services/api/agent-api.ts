/**
 * 阅读 Agent 的 REST 客户端（不带 Vue，纯 TS）。
 *
 * 约定：**所有会失败的网络调用都返回结构化结果**，不抛出。
 * 界面上要能明确说出「转写服务没开」，而不是转成一个看不懂的
 * FetchError —— 这个工具日常就是双进程在跑，服务没开是最常见的情况。
 */
import type {
  EvalReport,
  HealthReport,
  HighlightDeco,
  Item,
  VectorStatus,
  VaultNote,
} from '@/types/agent'

export interface NotePayload {
  aweme_id: string
  path: string
  text: string
  highlights?: HighlightDeco
}

export interface Fetched<T> {
  ok: boolean
  data?: T
  /** 服务端返回的结构化错误码，如 WorkerUnreachable / PathEscape */
  code?: string
  error?: string
  /** 给用户看的一句话处理建议 */
  hint?: string
}

async function req<T>(
  path: string,
  init?: RequestInit,
  hint?: string,
): Promise<Fetched<T>> {
  try {
    const res = await fetch(path, init)
    const text = await res.text()
    let parsed: unknown = {}
    try {
      parsed = text ? JSON.parse(text) : {}
    } catch {
      parsed = { error: text.slice(0, 200) }
    }
    const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
    if (!res.ok) {
      return {
        ok: false,
        code: String(obj.code || `HTTP${res.status}`),
        error: String(obj.error || `请求失败（${res.status}）`),
        hint,
      }
    }
    return { ok: true, data: parsed as T }
  } catch (e) {
    return {
      ok: false,
      code: 'NetworkError',
      error: e instanceof Error ? e.message : String(e),
      hint,
    }
  }
}

const FLASK_DOWN_HINT =
  '双击仓库根目录的 start-reading.bat（或 douyin-fav-transcribe/start-gui.bat），转写服务窗口不要关，然后点「重试」。'

/* --------------------------------------------------------------- 健康 */

export const getHealth = () =>
  req<HealthReport>('/api/agent/health', undefined, FLASK_DOWN_HINT)

/* --------------------------------------------------------------- 收藏夹 */

export const fetchItems = (src = 'fav', limit = 300) =>
  req<{ items: Item[]; total: number }>(
    `/api/agent/proxy/items?src=${src}&limit=${limit}&state=ok`,
    undefined,
    FLASK_DOWN_HINT,
  )

export const fetchFolders = () =>
  req<{ folders: Array<{ name: string; count: number; done: number }>; uncategorized: number }>(
    '/api/agent/proxy/folders',
    undefined,
    FLASK_DOWN_HINT,
  )

/* --------------------------------------------------------------- 笔记 */

export const fetchNote = (awemeId: string) =>
  req<NotePayload>(
    `/api/agent/proxy/note?aweme_id=${encodeURIComponent(awemeId)}`,
    undefined,
    '这条可能还没转写，或者笔记被移走了。',
  )

/** 直接读磁盘的库清单：Flask 没开也能用（markdown 是源真相）。 */
export const fetchVaultNotes = () =>
  req<{ dir: string; notes: VaultNote[] }>('/api/agent/notes')

export const openNoteDir = (path: string) =>
  req<{ ok: boolean }>('/api/agent/open-dir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })

/* --------------------------------------------------------------- 划线 */

export const rematchHighlights = (awemeId: string) =>
  req<{ ok: boolean; stats: Record<string, number>; highlights: HighlightDeco }>(
    '/api/agent/highlights/rematch',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aweme_id: awemeId }),
    },
    '重匹配只改这个笔记文件，不动正文。',
  )

/* --------------------------------------------------------------- memory */

export const getMemory = () =>
  req<{ path: string; text: string }>('/api/agent/memory', undefined, FLASK_DOWN_HINT)

/** 写 memory.md 必须显式 approved —— 服务端没带这个字段会 403。 */
export const putMemory = (text: string) =>
  req<{ ok: boolean; path: string }>('/api/agent/memory', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved: true, text }),
  })

export const getBehaviorLog = (limit = 200) =>
  req<{ total: number; stats: Record<string, number>; events: unknown[] }>(
    `/api/agent/log?limit=${limit}`,
  )

/** 只读编译：拿回 memory.md 草稿，不写盘。写盘必须再走 putMemory。 */
export const compileMemoryDraft = (days = 14) =>
  req<{ ok: boolean; days: number; events: number; draft: string; added: string[]; stats: Record<string, number> }>(
    `/api/agent/memory/compile?days=${days}`,
  )

export const clearBehaviorLog = () =>
  req<{ ok: boolean; note: string }>('/api/agent/log', { method: 'DELETE' })

/** 记一条行为日志。失败静默 —— 日志不该影响主流程。 */
export function logBehavior(payload: Record<string, unknown>): void {
  void fetch('/api/agent/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined)
}

/* ----------------------------------------------------------- 向量与索引 */

export const getRetrieveStatus = () =>
  req<{ obsidian_dir: string; notes_indexed: number; vector: VectorStatus; search: string }>(
    '/api/agent/retrieve/status',
    undefined,
    FLASK_DOWN_HINT,
  )

export const rebuildIndex = () =>
  req<{ ok: boolean; indexed: number }>('/api/agent/retrieve/rebuild', { method: 'POST' })

export const installVector = (uninstall = false) =>
  req<{ job_id: string; uninstall: boolean }>(
    '/api/agent/retrieve/install-vector',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uninstall }),
    },
    FLASK_DOWN_HINT,
  )

export const getJob = (id: string) =>
  req<{
    id: string
    status: string
    done: number
    total: number
    ok: number
    fail: number
    message: string
    current_title: string
    log: string[]
  }>(`/api/agent/retrieve/job/${encodeURIComponent(id)}`)

export const evalRetrieve = (k = 8, n = 20) =>
  req<EvalReport>(
    '/api/agent/retrieve/eval',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k, n }),
    },
    '评测要读整库造题，库很大时会慢一点。',
  )
