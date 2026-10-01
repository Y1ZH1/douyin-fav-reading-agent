/**
 * Agent 运行态（SSE 事件 → 界面状态）。
 *
 * 从 AgentView 里抽出来的原因：这一坨「发请求、吃事件、分派到各个面板」
 * 的逻辑和「三栏怎么摆」没关系，混在一起会同时膨胀。在这里它只认
 * 输入和事件，不认布局；AgentView 只认布局。
 *
 * SSE 事件 → 状态映射：
 *   state                 → agentState（UI 上显示"正在调用工具/正在生成"）
 *   tool_call/tool_result → traces[助手消息id]
 *   proposals             → proposals（候选，默认不钉）
 *   hitl_request          → hitl（弹确认卡，暂停等用户）
 *   followup_suggestions  → chips
 *   token                 → 追加到助手消息
 *   error                 → streamErr
 */
import { ref } from 'vue'
import { streamAgent } from '@/services/ai/agent-client'
import { logBehavior } from '@/services/api/agent-api'
import { useChatStore } from '@/stores/chat'
import type { AgentIntent, AgentState, HitlRequest, Proposals, Trace } from '@/types/agent'

export interface RunInput {
  intent: AgentIntent
  userText?: string
  selection?: string
  videoId?: string
  folderId?: string
  attached?: string[]
  hitl?: Record<string, unknown>
  customPrompt?: string
  /** 只要提案，别顺手带着上下文回答 */
  dryRun?: boolean
  /** 界面上用户气泡显示什么；不填用 userText */
  display?: string
}

export interface RunOptions {
  /** 不往对话里插用户气泡（HITL 回执、重试这类不该刷屏） */
  silent?: boolean
}

export function useAgentRun() {
  const store = useChatStore()

  const busy = ref(false)
  const agentState = ref<AgentState>('idle')
  const traces = ref<Record<string, Trace[]>>({})
  const chips = ref<string[]>([])
  const hitl = ref<HitlRequest | null>(null)
  const proposals = ref<Proposals | null>(null)
  const streamErr = ref('')
  const lastIntent = ref<AgentIntent | null>(null)

  let controller: AbortController | null = null

  function abort() {
    controller?.abort()
    controller = null
    busy.value = false
    agentState.value = 'idle'
  }

  function clearProposals() {
    proposals.value = null
  }

  function dismissHitl() {
    hitl.value = null
    agentState.value = 'idle'
  }

  async function run(input: RunInput, opts: RunOptions = {}): Promise<void> {
    const { intent, selection = '', videoId, folderId, attached = [], hitl: hitlBody } = input
    const userText = (input.userText ?? '').trim()

    // 没选中、也没输入，就没什么可做的
    if (!userText && !selection && intent !== 'classify' && intent !== 'memory_compile' && intent !== 'memory_patch') {
      return
    }
    if (intent === 'add_note' && !selection) return

    if (!store.activeSession) store.createSession()
    busy.value = true
    streamErr.value = ''
    hitl.value = null
    chips.value = []
    lastIntent.value = intent

    let assistantId = ''
    if (!opts.silent) {
      store.addMessage('user', input.display ?? userText ?? `(${intent})`)
    }
    const asst = store.addMessage('assistant', '')
    assistantId = asst.id
    traces.value[assistantId] = []

    controller = new AbortController()
    try {
      for await (const chunk of streamAgent(
        {
          intent,
          selection,
          videoId,
          folderId,
          attachedAwemeIds: attached,
          dryRun: input.dryRun,
          customPrompt: input.customPrompt,
          hitl: hitlBody,
          messages: (store.activeSession?.messages || [])
            .filter((m) => m.id !== asst.id && m.content)
            .slice(-12)
            .map((m) => ({ role: m.role, content: m.content })),
        },
        controller.signal,
      )) {
        dispatch(chunk, assistantId)
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        streamErr.value = ''
      } else {
        streamErr.value = e instanceof Error ? e.message : String(e)
      }
    } finally {
      busy.value = false
      if (agentState.value !== 'hitl') agentState.value = 'done'
      await store.updateMessageStatus(assistantId, 'done')
      controller = null
    }
  }

  function dispatch(chunk: { event?: string; content?: string; data?: unknown }, assistantId: string) {
    switch (chunk.event) {
      case 'state': {
        const d = chunk.data as { state?: AgentState } | undefined
        agentState.value = d?.state || 'idle'
        break
      }
      case 'tool_call': {
        const d = chunk.data as { name?: string; args?: unknown } | undefined
        traces.value[assistantId] = [
          ...(traces.value[assistantId] || []),
          { name: d?.name || '?', args: d?.args, at: Date.now() },
        ]
        break
      }
      case 'tool_result': {
        const d = chunk.data as { name?: string; result?: unknown } | undefined
        const list = traces.value[assistantId] || []
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].name === d?.name && list[i].result === undefined) {
            list[i] = { ...list[i], result: d?.result }
            break
          }
        }
        break
      }
      case 'proposals':
        proposals.value = chunk.data as Proposals
        break
      case 'hitl_request':
        hitl.value = chunk.data as HitlRequest
        agentState.value = 'hitl'
        break
      case 'followup_suggestions':
        chips.value = Array.isArray(chunk.data) ? (chunk.data as string[]) : []
        break
      case 'error':
        streamErr.value = (chunk.data as { message?: string } | undefined)?.message || '请求失败'
        break
      default:
        if (chunk.content) store.appendToMessage(assistantId, chunk.content)
        break
    }
  }

  /**
   * 不发网络请求，只在对话里留一条本地提示。
   *
   * 用途：用户点了「先给我一批候选笔记」但手上既没选中文字也没打开笔记 ——
   * 这时没有可用的查询词。与其编一个查询去搜（会得到零命中和一堆噪音），
   * 不如直接说清楚要先告诉我找什么。
   */
  function notice(text: string): void {
    if (!store.activeSession) store.createSession()
    store.addMessage('assistant', text)
  }

  /** 用户勾选候选后钉上：钉是用户动作，Agent 从不自己钉。 */
  function pinCandidates(ids: string[], titles: Record<string, string> = {}): void {
    for (const id of ids) store.attachAweme(id, titles[id])
    logBehavior({ kind: 'pin', pinned: ids })
    if (proposals.value) {
      proposals.value = {
        ...proposals.value,
        items: proposals.value.items.filter((c) => !ids.includes(c.awemeId)),
      }
    }
  }

  return {
    busy,
    agentState,
    traces,
    chips,
    hitl,
    proposals,
    streamErr,
    lastIntent,
    run,
    abort,
    dismissHitl,
    clearProposals,
    pinCandidates,
    notice,
  }
}
