/**
 * Agent 循环（Node 侧）。
 *
 * 面试上要讲清楚的一件事：**这个循环不是「调一次模型」**。它包含
 *   意图分派 → 工具调用 → 可能的人机中断（HITL）→ 流式回吐 → 行为落日志
 * 五段，模型推理只是其中一段。
 *
 * 状态机：idle → tool → streaming → (hitl) → followup → done
 * SSE 事件：state | token | tool_call | tool_result | proposals | hitl_request
 *          | followup_suggestions | error | done
 *
 * 两条不许破的规矩：
 *  1. 用户没让去找，就不检索；检索命中**不自动钉**进对话（proposals 只提案）。
 *  2. 不确认不写 memory.md；写笔记只写笔记库路径白名单内。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { chatCompletion, streamChatCompletion } from './services/ai.js'
import {
  appendBehavior,
  compileMemory,
  readBehavior,
  type BehaviorEvent,
} from './services/behavior-log.js'
import {
  classifyEvent,
  findCandidates,
  folderNames,
  getNote,
  JEV_DEFAULT_MIN_GAP,
  JEV_DEFAULT_THRESHOLD,
  repairHighlights,
  shouldAutoClassify,
  type Candidate,
} from './services/agent-tools.js'
import type { ChatMessage, StreamChunk } from './services/types.js'
import { assertInsideVault, flaskJson, readMemory, upsertHighlights, vaultRoot, writeMemory } from './vault.js'

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

export type AgentState = 'idle' | 'tool' | 'streaming' | 'hitl' | 'followup' | 'done'

export interface AgentRequest {
  intent: AgentIntent
  messages?: ChatMessage[]
  selection?: string
  videoId?: string
  folderId?: string
  customPrompt?: string
  hitl?: { action: 'approve' | 'pick' | 'skip' | 'create'; folderName?: string; memoryText?: string }
  jevThreshold?: number
  jevMinGap?: number
  apiKey?: string
  model?: string
  attachedAwemeIds?: string[]
  /** 用户只让检索、别顺手钉上下文（默认 false） */
  dryRun?: boolean
  /** memory 编译的回溯窗口（天），默认 14 */
  windowDays?: number
}

interface Sink {
  write: (s: string) => void
  writable: boolean
}

function sse(res: Sink, event: string, data: unknown) {
  if (!res.writable) return
  res.write(`data: ${JSON.stringify({ event, data })}\n\n`)
}

/** 模型偶尔会裹一层 ```json，这里只负责把第一个 JSON 对象抠出来。 */
function extractJson<T>(text: string): T {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('ToolParseError')
  return JSON.parse(m[0]) as T
}

/** classify_item 的结构化输出 */
interface ClassifyOut {
  folderName?: string
  confidence?: number
  alt?: Array<{ folderName?: string; confidence?: number }>
}

function lastUserText(body: AgentRequest): string {
  return (body.messages?.at(-1)?.content || body.selection || '').trim()
}

export async function runAgent(body: AgentRequest, res: Sink) {
  const root = await vaultRoot()
  const memory = readMemory(root)
  const creds = { apiKey: body.apiKey, model: body.model }
  const history = (body.messages || []).map((m) => `${m.role}: ${m.content}`).join('\n')

  const emitTool = (name: string, args: unknown, result: unknown) => {
    sse(res, 'state', { state: 'tool', tool: name })
    sse(res, 'tool_call', { name, args })
    sse(res, 'tool_result', { name, result })
  }
  const streamLine = (text: string) => sse(res, 'token', { content: text })

  /* ------------------------------------------------------- memory 编译 */

  if (body.intent === 'memory_compile') {
    const days = body.windowDays ?? 14
    const events = readBehavior(2000)
    const out = compileMemory(memory.text, events, days * 24)
    emitTool('compile_memory', { events: events.length, days }, {
      added: out.added.length,
      stats: out.stats,
    })
    if (!out.added.length) {
      streamLine('这段时间的行为还不够构成习惯。要么再多用几次，要么直接跟我说「记住 …」。')
      sse(res, 'done', { ok: true })
      return
    }
    sse(res, 'state', { state: 'hitl' })
    sse(res, 'hitl_request', {
      kind: 'memory',
      current: out.draft,
      source: 'compiled',
      added: out.added,
      stats: out.stats,
      message: `我从最近 ${days} 天的行为日志里编译出 ${out.added.length} 条习惯。改完（或直接确认）才会写入 memory.md。`,
    })
    sse(res, 'done', { ok: true })
    return
  }

  /* ------------------------------------------------------- memory 写入 */

  if (body.intent === 'memory_patch') {
    if (body.hitl?.action !== 'approve' || typeof body.hitl.memoryText !== 'string') {
      const asked = lastUserText(body)
      const draft = asked ? `${memory.text.trimEnd()}\n- ${asked}\n` : memory.text
      if (asked) appendBehavior({ kind: 'memory_request', text: asked })
      sse(res, 'state', { state: 'hitl' })
      sse(res, 'hitl_request', {
        kind: 'memory',
        current: draft,
        source: 'user',
        message: '这是准备写入 memory.md 的内容。确认后才会保存。',
      })
      sse(res, 'done', { ok: true })
      return
    }
    emitTool('propose_memory_patch', { approved: true }, { wrote: true })
    writeMemory(root, body.hitl.memoryText)
    streamLine('已写入 memory.md。')
    sse(res, 'done', { ok: true })
    return
  }

  /* ----------------------------------------------------------- 检索 */

  if (body.intent === 'retrieve' || body.intent === 'propose') {
    const q = lastUserText(body) || String(body.selection || '')
    const { items, via, error } = await findCandidates(root, q, body.videoId, body.folderId, 8)
    if (error) {
      sse(res, 'error', {
        code: 'WorkerUnreachable',
        message: '检索服务未启动（Flask :8899）。问题：连不上转写索引。'
          + '处理：先开 douyin-fav-transcribe 再重试；若已开，可能是索引未建，点「重建索引」。'
          + '本次结果来自本地粗筛，不是全文索引。',
      })
    }
    emitTool('retrieve_vault', { q, videoId: body.videoId, folderId: body.folderId }, items)
    appendBehavior({ kind: 'retrieve', query: q, hits: items.length, videoId: body.videoId })

    if (!items.length) {
      streamLine('检索没有命中。笔记库里没有足够接近的片段，我不会编造出处。')
      sse(res, 'done', { ok: true })
      return
    }

    // 只提案，不钉。钉不钉由用户在界面上勾选决定。
    sse(res, 'proposals', { query: q, via, items, pinned: false })
    const scopeNote = via === 'flask' ? '' : '（Flask 检索没连上，这是本地粗筛结果）'
    streamLine(
      `找到 ${items.length} 篇候选${scopeNote}。这些**只用于这一轮**，默认没有钉进对话。` +
      `要长期带上，勾选之后点「钉上并 @」。`,
    )
    if (body.intent === 'propose' || body.dryRun) {
      sse(res, 'done', { ok: true })
      return
    }
    // retrieve 意图下也允许顺手回答一轮（用检索到的片段，不假装已钉）
    const md = items.map((h, i) => `${i + 1}. **${h.title}**\n${h.span || ''}`).join('\n\n')
    sse(res, 'state', { state: 'streaming' })
    await streamChatCompletion(
      {
        ...creds,
        messages: [
          {
            role: 'system',
            content: `只用下面检索到的片段回答。不够就说没找到，不要编。不要说这些笔记已经钉进对话。\n\n${md}`,
          },
          { role: 'user', content: q },
        ],
      },
      (chunk: StreamChunk) => {
        if (res.writable && (chunk.content || chunk.reasoning)) sse(res, 'token', chunk)
      },
    )
    sse(res, 'done', { ok: true })
    return
  }

  /* --------------------------------------------------------- 入笔记 */

  if (body.intent === 'add_note') {
    const quote = (body.selection || '').trim()
    if (!quote) {
      sse(res, 'error', { code: 'EmptySelection', message: '没有选中文本，无法写入笔记。' })
      sse(res, 'done', { ok: false })
      return
    }
    if (!body.videoId) {
      sse(res, 'state', { state: 'hitl' })
      sse(res, 'hitl_request', { kind: 'note_target', message: '不知道写到哪条视频笔记。请先打开一条转写。' })
      sse(res, 'done', { ok: true })
      return
    }
    const note = await getNote(root, body.videoId)
    if (!note) {
      sse(res, 'error', {
        code: 'VaultIoError',
        message: '笔记文件不存在：这条视频可能还没转写，或者笔记被移走了。',
      })
      sse(res, 'done', { ok: false })
      return
    }
    const abs = assertInsideVault(root, note.path)
    const next = upsertHighlights(readFileSync(abs, 'utf8'), { quote })
    writeFileSync(abs, next, 'utf8')
    const repaired = (next.match(/status: stale/g) || []).length
    emitTool('add_to_notes', { videoId: body.videoId, quote: quote.slice(0, 80) }, {
      path: abs,
      stale: repaired,
    })
    appendBehavior({
      kind: 'add_note',
      videoId: body.videoId,
      quoteHead: quote.slice(0, 40),
    })
    streamLine(
      `已写入划线：\`${abs}\`` +
      (repaired ? `\n\n注意：这篇笔记里有 ${repaired} 条划线没能在当前正文里定位到（stale）。点中间顶部的「重匹配划线」可以再修一次。` : ''),
    )
    sse(res, 'done', { ok: true })
    return
  }

  /* --------------------------------------------------------- 分类 */

  if (body.intent === 'classify' && body.hitl?.action === 'skip') {
    appendBehavior(classifyEvent(body.videoId, '', 'skip'))
    streamLine('已跳过分类。')
    sse(res, 'done', { ok: true })
    return
  }

  if (
    body.intent === 'classify' &&
    (body.hitl?.action === 'pick' || body.hitl?.action === 'create') &&
    body.hitl.folderName
  ) {
    try {
      await applyFolder(body.videoId, body.hitl.folderName, emitTool)
      appendBehavior(classifyEvent(body.videoId, body.hitl.folderName, body.hitl.action))
      streamLine(`已归入「${body.hitl.folderName}」。`)
    } catch (e) {
      sse(res, 'error', { message: (e as Error).message })
    }
    sse(res, 'done', { ok: true })
    return
  }

  if (body.intent === 'classify') {
    const names = await folderNames().catch(() => [] as string[])
    if (!names.length) {
      sse(res, 'error', {
        code: 'WorkerUnreachable',
        message: '拿不到收藏夹列表（Flask :8899 未启动）。分类必须对着真实收藏夹做，先开转写服务。',
      })
      sse(res, 'done', { ok: false })
      return
    }
    const note = body.videoId ? await getNote(root, body.videoId) : null
    const noteText = (note?.body || body.selection || '无正文').slice(0, 4000)
    const raw = await chatCompletion({
      ...creds,
      messages: [
        {
          role: 'system',
          content: `你把抖音转写分到已有收藏夹。只输出 JSON：{"folderName":string,"confidence":number,"alt":[{"folderName":string,"confidence":number}]}。收藏夹列表：${JSON.stringify(names)}`,
        },
        { role: 'user', content: noteText },
      ],
    })
    let parsed: ClassifyOut
    try {
      parsed = extractJson<ClassifyOut>(raw)
    } catch {
      sse(res, 'error', { code: 'ToolParseError', message: '分类结果无法解析。' })
      sse(res, 'done', { ok: false })
      return
    }
    const conf = Number(parsed.confidence) || 0
    const alt = Array.isArray(parsed.alt) ? parsed.alt : []
    const second = Number(alt[0]?.confidence) || 0
    const threshold = body.jevThreshold ?? JEV_DEFAULT_THRESHOLD
    const minGap = body.jevMinGap ?? JEV_DEFAULT_MIN_GAP
    emitTool('classify_item', { names }, parsed)
    const { auto, reason } = shouldAutoClassify(conf, second, threshold, minGap)
    if (auto && parsed.folderName) {
      try {
        await applyFolder(body.videoId, String(parsed.folderName), emitTool)
      } catch (e) {
        sse(res, 'error', { message: (e as Error).message })
        sse(res, 'done', { ok: false })
        return
      }
      appendBehavior(classifyEvent(body.videoId, String(parsed.folderName), 'auto', { confidence: conf }))
      streamLine(`已自动归入「${parsed.folderName}」（${reason}）。`)
    } else {
      sse(res, 'state', { state: 'hitl' })
      sse(res, 'hitl_request', {
        kind: 'classify',
        options: names,
        suggestion: parsed.folderName,
        confidence: conf,
        gap: conf - second,
        reason,
        message: '置信度不够或两个夹子太近，请选择已有夹 / 新建 / 跳过。',
      })
    }
    sse(res, 'done', { ok: true })
    return
  }

  /* ------------------------------------------------- 解释 / 总结 / 追问 */

  let pinned = ''
  for (const id of (body.attachedAwemeIds || []).slice(0, 4)) {
    const note = await getNote(root, id)
    if (!note?.text) continue
    pinned += `\n\n【钉选笔记 ${id}】\n路径: ${note.path || ''}\n${note.text.slice(0, 8000)}`
  }

  const sys = `你是本地抖音收藏阅读助手。只用用户钉选的笔记和选中原文。不要编造检索出处。用户没让你去库里找时，不要声称你搜过别的笔记。
${memory.text}

用户自定义说明：${body.customPrompt || '无'}
${pinned}`

  let userExtra = history
  if (body.selection) userExtra += `\n\n【选中原文】\n${body.selection}`
  if (body.intent === 'explain') userExtra += '\n\n请解释这段话，用中文，短句。'
  if (body.intent === 'summarize') userExtra += '\n\n请总结这段话的要点，列表。'
  if (body.intent === 'followup') userExtra += '\n\n基于上一轮继续回答。'

  if (body.intent === 'explain' || body.intent === 'summarize') {
    appendBehavior({
      kind: body.intent === 'explain' ? 'highlight_explain' : 'highlight_summarize',
      videoId: body.videoId,
      prompt: body.customPrompt || '',
      quoteHead: (body.selection || '').slice(0, 40),
    })
  }

  sse(res, 'state', { state: 'streaming' })
  await streamChatCompletion(
    { messages: [{ role: 'system', content: sys }, { role: 'user', content: userExtra || '你好' }], ...creds },
    (chunk: StreamChunk) => {
      if (res.writable && (chunk.content || chunk.reasoning)) sse(res, 'token', chunk)
    },
  )

  sse(res, 'state', { state: 'followup' })
  const follow = await chatCompletion({
    ...creds,
    temperature: 0.4,
    max_tokens: 256,
    messages: [
      {
        role: 'system',
        content: `根据对话列出 3 条中文追问，只输出 JSON 数组，每项不超过 24 字。追问风格参考：\n${memory.text}`,
      },
      { role: 'user', content: userExtra.slice(-2000) },
    ],
  }).catch(() => '[]')
  let chips: string[] = []
  try {
    chips = JSON.parse(follow.replace(/```json|```/g, '').trim())
    if (!Array.isArray(chips)) chips = []
  } catch {
    chips = []
  }
  sse(res, 'followup_suggestions', chips.slice(0, 3))
  sse(res, 'done', { ok: true })
}

async function applyFolder(
  videoId: string | undefined,
  folderName: string,
  emitTool: (name: string, args: unknown, result: unknown) => void,
) {
  if (!videoId || !folderName) return
  const out = await flaskJson('/api/assign-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aweme_id: videoId, folderName }),
  })
  emitTool('classify_item', { folderName }, out)
}

export { repairHighlights }
export type { BehaviorEvent, Candidate }
