import { Router } from 'express'
import { runAgent, type AgentRequest } from '../agent.js'
import { appendBehavior, behaviorStats, clearBehavior, compileMemory, readBehavior, type BehaviorKind } from '../services/behavior-log.js'
import {
  assertInsideVault,
  countVaultNotes,
  flaskAlive,
  flaskJson,
  listVaultNotes,
  readMemory,
  rematchNote,
  vaultRoot,
  writeMemory,
} from '../vault.js'

export const agentRouter = Router()

const FLASK = process.env.DOUYIN_FLASK_URL || 'http://127.0.0.1:8899'

/* --------------------------------------------------------------- memory */

agentRouter.get('/memory', async (_req, res) => {
  try {
    const root = await vaultRoot()
    res.json(readMemory(root))
  } catch (e) {
    const err = e as Error
    res.status(503).json({ code: 'WorkerUnreachable', error: err.message })
  }
})

/**
 * 写 memory.md。**必须显式 approved: true** —— 这条规矩不许绕。
 * 没带 approved 一律 403，且要在响应里说清楚「被拦了」，不能静默吞掉。
 */
agentRouter.put('/memory', async (req, res) => {
  try {
    const root = await vaultRoot()
    if (!req.body?.approved) {
      res.status(403).json({
        code: 'RejectedWrite',
        error: '未授权写入已阻止：改 memory.md 需要 approved: true（界面上是「确认写入」按钮）。',
      })
      return
    }
    const p = writeMemory(root, String(req.body.text ?? ''))
    res.json({ ok: true, path: p })
  } catch (e) {
    const err = e as Error
    res.status(400).json({ error: err.message })
  }
})

/* ---------------------------------------------------------- 行为日志 */

agentRouter.post('/log', (req, res) => {
  const kind = String(req.body?.kind || '') as BehaviorKind
  if (!kind) {
    res.status(400).json({ error: 'kind required' })
    return
  }
  const event = appendBehavior({ ...req.body, kind })
  res.json({ ok: true, event, path: undefined })
})

agentRouter.get('/log', (req, res) => {
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 200))
  const kind = (req.query.kind as BehaviorKind) || undefined
  const events = readBehavior(limit, kind)
  res.json({ total: events.length, stats: behaviorStats(events), events })
})

/**
 * 只读编译：把行为日志聚合成 memory.md 草稿并返回，**绝不写盘**。
 * 设置页拿它填文本框，用户点「确认写入」才走 PUT /memory。
 * 聊天里那个 memory_compile 意图走的是同一条编译逻辑，只是改走 SSE + HITL。
 */
agentRouter.get('/memory/compile', async (req, res) => {
  try {
    const root = await vaultRoot()
    const days = Math.min(180, Math.max(1, Number(req.query.days) || 14))
    const events = readBehavior(2000)
    const out = compileMemory(readMemory(root).text, events, days * 24)
    res.json({ ok: true, days, events: events.length, ...out })
  } catch (e) {
    res.status(503).json({ code: 'WorkerUnreachable', error: (e as Error).message })
  }
})

agentRouter.delete('/log', (_req, res) => {
  // 清空日志只影响「memory 编译的依据」，不动任何笔记，也不动已写入的 memory.md
  clearBehavior()
  res.json({ ok: true, note: '行为日志已清空。memory.md 不受影响。' })
})

/* --------------------------------------------------------------- 笔记库 */

/** 直接读磁盘的笔记清单（Flask 没开时前端也能列库）。 */
agentRouter.get('/notes', async (_req, res) => {
  try {
    const root = await vaultRoot()
    res.json({ dir: root, notes: listVaultNotes(root, 800) })
  } catch (e) {
    res.status(503).json({ code: 'WorkerUnreachable', error: (e as Error).message })
  }
})

/** 重转写之后修一次划线定位。 */
agentRouter.post('/highlights/rematch', async (req, res) => {
  try {
    const root = await vaultRoot()
    const abs = assertInsideVault(root, String(req.body?.path || ''))
    const out = rematchNote(abs)
    res.json({ ok: true, ...out })
  } catch (e) {
    const err = e as Error & { code?: string }
    res.status(err.code === 'PathEscape' ? 403 : 400).json({
      code: err.code || 'VaultIoError',
      error: err.message,
    })
  }
})

/* ------------------------------------------------------------- 健康检查 */

interface Probe {
  ok: boolean
  error?: string
  data?: Record<string, unknown>
}

async function probe(path: string, timeoutMs = 2000): Promise<Probe> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const data = await flaskJson<Record<string, unknown>>(path, { signal: ctrl.signal })
    return { ok: true, data }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 开机自检：Node 活着、转写服务在不在、库在哪、索引与向量什么状态。
 * 前端顶部的横幅就吃这一个接口，避免到处 try/catch 凑状态。
 */
agentRouter.get('/health', async (_req, res) => {
  const flask = await flaskAlive(1500)
  const [status, health] = flask.ok
    ? await Promise.all([probe('/api/retrieve/status'), probe('/api/health')])
    : [{ ok: false } as Probe, { ok: false } as Probe]

  let vaultDir = process.env.DOUYIN_OBSIDIAN_DIR || ''
  let notes = 0
  try {
    const root = await vaultRoot()
    vaultDir = root
    // 只数文件，不读内容 —— 健康检查会被反复调，不能把整库读一遍
    notes = countVaultNotes(root)
  } catch {
    /* ignore */
  }

  res.json({
    ok: true,
    node: { ok: true, port: Number(process.env.PORT || 3001) },
    flask: {
      ok: flask.ok,
      url: FLASK,
      dir: flask.dir || String(health.data?.obsidian_dir || ''),
      error: flask.ok ? undefined : flask.error,
    },
    vector: status.data?.vector || { installed: false, note: '转写服务未启动，无法读取向量状态' },
    index: {
      notes_indexed: (status.data?.notes_indexed as number | undefined) ?? null,
      built: Boolean(status.data?.notes_indexed),
    },
    vault: { dir: vaultDir, notes_on_disk: notes },
  })
})

/* --------------------------------------------------------------- 代理 */

agentRouter.get('/proxy/items', async (req, res) => {
  try {
    const q = new URLSearchParams(req.query as Record<string, string>).toString()
    res.json(await flaskJson(`/api/items?${q}`))
  } catch (e) {
    const err = e as Error & { code?: string }
    res.status(503).json({ code: err.code || 'WorkerUnreachable', error: err.message })
  }
})

agentRouter.get('/proxy/folders', async (_req, res) => {
  try {
    res.json(await flaskJson('/api/folders'))
  } catch (e) {
    const err = e as Error
    res.status(503).json({ code: 'WorkerUnreachable', error: err.message })
  }
})

agentRouter.get('/proxy/note', async (req, res) => {
  try {
    const aid = String(req.query.aweme_id || '')
    res.json(await flaskJson(`/api/note?aweme_id=${encodeURIComponent(aid)}`))
  } catch (e) {
    const err = e as Error
    res.status(404).json({ error: err.message })
  }
})

/** 向量：状态 / 安装 / 卸载 / 评测 / 重建索引 —— 全部透传给 Flask 工人。 */
for (const [method, path] of [
  ['get', '/retrieve/status'],
  ['post', '/retrieve/install-vector'],
  ['post', '/retrieve/rebuild'],
  ['post', '/retrieve/eval'],
] as const) {
  agentRouter[method](path, async (req, res) => {
    try {
      const init: RequestInit = { method: method === 'get' ? 'GET' : 'POST' }
      if (method === 'post') {
        init.headers = { 'Content-Type': 'application/json' }
        init.body = JSON.stringify(req.body || {})
      }
      const data = await flaskJson(`/api${path}`, init)
      res.json(data)
    } catch (e) {
      const err = e as Error & { code?: string }
      res.status(503).json({
        code: err.code || 'WorkerUnreachable',
        error: '检索服务未启动（Flask :8899）。' + err.message,
      })
    }
  })
}

/** 轮询向量安装进度（Flask 的 job 表）。 */
agentRouter.get('/retrieve/job/:id', async (req, res) => {
  try {
    const id = encodeURIComponent(req.params.id)
    const job = await flaskJson<Record<string, unknown>>(`/api/jobs/${id}`)
    const detail = await flaskJson<{ log?: string[] }>(`/api/jobs/${id}/results`).catch(
      () => ({ log: [] as string[] }),
    )
    res.json({ ...job, log: (detail.log || []).slice(-60) })
  } catch (e) {
    res.status(503).json({ code: 'WorkerUnreachable', error: (e as Error).message })
  }
})

agentRouter.post('/open-dir', async (req, res) => {
  try {
    const root = await vaultRoot()
    const abs = assertInsideVault(root, String(req.body?.path || ''))
    const { spawn } = await import('node:child_process')
    const { dirname } = await import('node:path')
    spawn('explorer', [dirname(abs)], { detached: true, stdio: 'ignore' }).unref()
    res.json({ ok: true })
  } catch (e) {
    const err = e as Error
    res.status(400).json({ error: err.message })
  }
})

/* ------------------------------------------------------------- SSE */

agentRouter.post('/stream', (req, res) => {
  const body = req.body as AgentRequest
  if (!body?.intent) {
    res.status(400).json({ error: 'intent required' })
    return
  }
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  req.socket?.setNoDelay?.(true)
  res.flushHeaders()

  runAgent(body, res)
    .then(() => {
      if (res.writable) res.write('data: [DONE]\n\n')
      res.end()
    })
    .catch((error: unknown) => {
      const errMsg = error instanceof Error ? error.message : String(error)
      if (res.writable) {
        res.write(`data: ${JSON.stringify({ event: 'error', data: { message: errMsg } })}\n\n`)
        res.write('data: [DONE]\n\n')
      }
      res.end()
    })
})
