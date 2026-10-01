/** 阅读 Agent 的类型。前后端共用的那部分按 SSE 事件名一一对应。 */

export type AgentIntent =
  | 'chat'
  | 'explain'
  | 'summarize'
  | 'add_note'
  | 'classify'
  | 'retrieve'
  | 'propose'
  | 'followup'
  | 'memory_patch'
  | 'memory_compile'

/** 服务端状态机的镜像，用于在 UI 上显示「现在在干什么」 */
export type AgentState = 'idle' | 'tool' | 'streaming' | 'hitl' | 'followup' | 'done'

export interface Item {
  aweme_id: string
  title: string
  author: string
  state: string
  folders: string[]
}

export interface Trace {
  name: string
  args?: unknown
  result?: unknown
  at: number
}

/** 检索/提案返回的一条候选。`via: 'local'` 表示这是 Flask 没开时的本地粗筛。 */
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

export interface Proposals {
  query: string
  via: 'flask' | 'local'
  items: Candidate[]
  /** 恒为 false：检索命中默认不钉，钉由用户在界面上勾选决定 */
  pinned: boolean
}

export interface HitlRequest {
  kind: 'classify' | 'memory' | 'note_target'
  message: string
  options?: string[]
  suggestion?: string
  confidence?: number
  gap?: number
  reason?: string
  /** memory 类：待写入的全文 */
  current?: string
  /** memory 类：来自用户「记住」还是行为日志编译 */
  source?: 'user' | 'compiled'
  added?: string[]
  stats?: Record<string, number>
}

export interface VectorStatus {
  installed: boolean
  package_version?: string
  venv?: string
  venv_exists?: boolean
  model?: string
  model_dir?: string
  model_cached?: boolean
  loaded?: boolean
  failed?: boolean
  error?: string
  pip_index?: string
  hf_endpoint?: string
  fallback?: string
  note?: string
}

export interface HealthReport {
  ok: boolean
  node: { ok: boolean; port: number }
  flask: { ok: boolean; url: string; dir?: string; error?: string }
  vector: VectorStatus
  index: { notes_indexed: number | null; built: boolean }
  vault: { dir: string; notes_on_disk: number }
}

export interface EvalReport {
  ok: boolean
  error?: string
  cases?: number
  k?: number
  fts?: { recall: number; mrr: number; hits: number; miss: unknown[] }
  vector?: { recall: number; mrr: number; hits: number; miss: unknown[] } | null
  vector_available?: boolean
  delta_recall?: number | null
  note?: string
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

/** 划线写回后，笔记里自带的划线统计 */
export interface HighlightDeco {
  total: number
  byStatus: Record<string, number>
  items: Array<{ id: string; quote: string; start: number; end: number; status: string }>
}
