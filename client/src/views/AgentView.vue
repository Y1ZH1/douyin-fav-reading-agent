<script setup lang="ts">
/**
 * 阅读页：三栏装配 + 两侧数据的取用。
 *
 * 这一层刻意保持"哑"：只管布局、加载、把事件转成 Agent 调用。
 * SSE 的事件分发在 useAgentRun，笔记/收藏夹的取数在 agent-api，
 * 划线的落库格式在 highlights.ts —— 各自有各自的家。
 *
 * 产品规矩（别在改动时破坏）：
 *  - 最左只有「对话」「收藏夹」，没有个人简介 / 代码差异 / 代码分析
 *  - 材料与会话分离：markdown 是源真相，对话在浏览器 IndexedDB
 *  - 没说要找就不检索；检索命中不自动钉
 *  - 改 memory.md 必须确认
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import FolderTree from '@/components/agent/FolderTree.vue'
import NotePane from '@/components/agent/NotePane.vue'
import ChatPane from '@/components/agent/ChatPane.vue'
import HitlCard from '@/components/agent/HitlCard.vue'
import CandidateTray from '@/components/agent/CandidateTray.vue'
import HealthBanner from '@/components/agent/HealthBanner.vue'
import { useAgentRun } from '@/composables/useAgentRun'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import {
  fetchItems,
  fetchNote,
  getHealth,
  openNoteDir,
  rematchHighlights as apiRematch,
} from '@/services/api/agent-api'
import { useRouter } from 'vue-router'
import type { AgentIntent, HealthReport, HighlightDeco, Item } from '@/types/agent'

const router = useRouter()
const store = useChatStore()
const settings = useSettingsStore()
const { sessions, activeSessionId, activeSession } = storeToRefs(store)

const agent = useAgentRun()
// 解构出来模板里才能自动拆 ref（嵌套在普通对象里的 ref 模板不会自动展开）
const { busy, agentState, streamErr, chips, traces, proposals, hitl } = agent

/* ------------------------------------------------------------- 本地状态 */

const items = ref<Item[]>([])
const loadingItems = ref(false)
const itemsError = ref('')

const active = ref<Item | null>(null)
const noteText = ref('')
const notePath = ref('')
const noteMissing = ref('')
const loadingNote = ref(false)
const highlights = ref<HighlightDeco | null>(null)
const rematching = ref(false)
const selection = ref('')

const health = ref<HealthReport | null>(null)
const checking = ref(false)
const mentionTitles = ref<string[]>([])

const messages = computed(() => activeSession.value?.messages || [])
const related = computed(() =>
  sessions.value.filter((s) => active.value && s.attachedAwemeIds?.includes(active.value.aweme_id)),
)

/* --------------------------------------------------------------- 取数 */

async function checkHealth() {
  checking.value = true
  const res = await getHealth()
  checking.value = false
  if (res.ok && res.data) health.value = res.data
}

async function loadItems() {
  loadingItems.value = true
  itemsError.value = ''
  const res = await fetchItems()
  loadingItems.value = false
  if (!res.ok) {
    itemsError.value = `${res.error}${res.hint ? ` —— ${res.hint}` : ''}`
    items.value = []
    return
  }
  items.value = res.data?.items || []
}

async function openItem(it: Item, keepSession = false) {
  active.value = it
  noteMissing.value = ''
  loadingNote.value = true
  const res = await fetchNote(it.aweme_id)
  loadingNote.value = false
  if (!res.ok) {
    noteText.value = ''
    notePath.value = ''
    noteMissing.value = `${res.error}${res.hint ? ` —— ${res.hint}` : ''}`
    highlights.value = null
    return
  }
  noteText.value = res.data?.text || ''
  notePath.value = res.data?.path || ''
  highlights.value = res.data?.highlights || null

  // 打开笔记时自动切到「和这篇有关的对话」，没有就留在原地
  const alreadyPinned = store.activeSession?.attachedAwemeIds?.includes(it.aweme_id)
  if (!keepSession && !alreadyPinned && related.value[0]) store.switchSession(related.value[0].id)
}

async function reloadNote() {
  if (active.value) await openItem(active.value, true)
}

async function doRematch() {
  if (!active.value) return
  rematching.value = true
  const res = await apiRematch(active.value.aweme_id)
  rematching.value = false
  if (res.ok) {
    highlights.value = res.data?.highlights || null
    await reloadNote()
  } else {
    agent.streamErr.value = `${res.error}${res.hint ? ` —— ${res.hint}` : ''}`
  }
}

/* ----------------------------------------------------------- 会话动作 */

function newEmptyChat() {
  store.createSession({ title: '新对话' })
}

function newChatFromNote() {
  if (!active.value) return
  store.createSession({
    title: active.value.title.slice(0, 40) || '这条笔记',
    videoName: active.value.title,
    attachedAwemeIds: [active.value.aweme_id],
  })
}

function pinCurrentNote() {
  if (!active.value) return
  if (!store.activeSession) newChatFromNote()
  else store.attachAweme(active.value.aweme_id, active.value.title)
}

function openChat(id: string) {
  store.switchSession(id)
}

function onCopyPath() {
  void navigator.clipboard?.writeText(notePath.value)
}

async function onOpenDir() {
  if (!notePath.value) return
  await openNoteDir(notePath.value)
}

/* ------------------------------------------------------------- 跑 Agent */

function ctx() {
  return {
    videoId: active.value?.aweme_id,
    folderId: active.value?.folders?.[0],
    attached: store.activeSession?.attachedAwemeIds || [],
  }
}

async function submitText(text: string) {
  const intent: AgentIntent = /记住/.test(text)
    ? 'memory_patch'
    : /去.{0,6}(找|搜)|检索|库里找|搜一下/.test(text)
      ? 'retrieve'
      : 'chat'
  await agent.run({ intent, userText: text, selection: selection.value, ...ctx() })
}

async function onAction(payload: { kind: 'explain' | 'summarize' | 'add_note' | 'retrieve' | 'classify'; prompt?: string }) {
  const prompt = (payload.prompt || '').trim()
  if (prompt && (payload.kind === 'explain' || payload.kind === 'summarize')) {
    // 划线时现写的提示词顺手存成默认，下次不用重打
    settings.update(payload.kind === 'explain' ? 'explainPrompt' : 'summarizePrompt', prompt)
  }
  const intent: AgentIntent = payload.kind
  await agent.run({ intent, selection: selection.value, customPrompt: prompt || undefined, ...ctx() })
  if (payload.kind === 'add_note') await reloadNote()
}

async function onPropose() {
  const seed = (selection.value || active.value?.title || '').trim()
  if (!seed) {
    agent.notice(
      '要往哪个方向找？先在左边打开一篇笔记，或者在输入框里说一句要找什么（比如「讲拖延症和情绪的那几条」）。\n\n我不会凭空搜一遍库再把结果堆给你 —— 没方向的检索只会是噪音。',
    )
    return
  }
  await agent.run({ intent: 'propose', userText: seed, dryRun: true, ...ctx() })
}

async function onCompileMemory() {
  await agent.run({ intent: 'memory_compile' }, { silent: true })
}

async function onHitlClassify(action: 'pick' | 'create' | 'skip', folderName?: string) {
  await agent.run(
    { intent: 'classify', hitl: { action, folderName }, ...ctx() },
    { silent: true },
  )
  if (action !== 'skip') await loadItems()
}

async function onHitlMemory(text: string) {
  await agent.run(
    { intent: 'memory_patch', hitl: { action: 'approve', memoryText: text } },
    { silent: true },
  )
}

function onPinCandidates(ids: string[], titles: Record<string, string>) {
  // 钉笔记是用户动作，日志也记在 pinCandidates 里（Agent 从不自己钉）
  agent.pinCandidates(ids, titles)
}

function onMention(titles: string[]) {
  mentionTitles.value = []
  // 触发 ChatPane 的 watch：先清空再赋值，连续两次 @ 也能生效
  setTimeout(() => (mentionTitles.value = titles), 0)
}

onMounted(() => {
  store.initDB()
  void checkHealth()
  void loadItems()
})
onUnmounted(() => agent.abort())
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <HealthBanner :health="health" :checking="checking" @recheck="() => { checkHealth(); loadItems() }" @goto="(r: string) => router.push({ name: r })" />
    <div class="flex min-h-0 flex-1">
      <FolderTree
        :items="items"
        :sessions="sessions"
        :active-aweme-id="active?.aweme_id"
        :active-session-id="activeSessionId"
        :loading="loadingItems"
        :error="itemsError"
        @open-item="openItem"
        @open-chat="openChat"
        @new-chat="newEmptyChat"
        @new-chat-from-note="newChatFromNote"
        @delete-chat="store.deleteSession"
        @refresh="() => { checkHealth(); loadItems() }"
      />

      <NotePane
        :item="active"
        :note-text="noteText"
        :note-path="notePath"
        :loading="loadingNote"
        :missing="noteMissing"
        :related="related"
        :active-session-id="activeSessionId"
        :highlights="highlights"
        :rematching="rematching"
        @selection="(t: string) => (selection = t)"
        @action="onAction"
        @copy-path="onCopyPath"
        @open-dir="onOpenDir"
        @rematch="doRematch"
        @switch-chat="openChat"
        @new-chat-from-note="newChatFromNote"
        @pin-note="pinCurrentNote"
      />

      <ChatPane
        :session="activeSession"
        :messages="messages"
        :busy="busy"
        :agent-state="agentState"
        :stream-err="streamErr"
        :chips="chips"
        :traces="traces"
        :mention-titles="mentionTitles"
        @submit="submitText"
        @followup="(t: string) => agent.run({ intent: 'followup', userText: t, ...ctx() })"
        @abort="agent.abort"
        @propose="onPropose"
        @compile-memory="onCompileMemory"
      >
        <template #proposals>
          <CandidateTray
            v-if="proposals"
            :proposals="proposals"
            :attached-ids="store.activeSession?.attachedAwemeIds || []"
            @pin="onPinCandidates"
            @mention="onMention"
            @dismiss="agent.clearProposals"
          />
        </template>
        <template #hitl>
          <HitlCard
            v-if="hitl"
            :hitl="hitl"
            @classify="onHitlClassify"
            @memory="onHitlMemory"
            @cancel="agent.dismissHitl"
          />
        </template>
      </ChatPane>
    </div>
  </div>
</template>
