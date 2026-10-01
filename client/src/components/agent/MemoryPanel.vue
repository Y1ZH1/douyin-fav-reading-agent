<script setup lang="ts">
/**
 * memory.md 面板。
 *
 * 这里是全项目最需要「别扭一点」的地方 —— 产品规格写得很死：
 * memory.md 由 Agent 维护，用户能看，**要改必须确认**。
 * 所以这个面板的交互是：读 → 编译/手改 → 点「确认写入」。
 * 没有任何一条路径会自动落盘。
 *
 * 「编译」的输入是行为日志（划线、入笔记、分类、检索），输出是草稿。
 * 草稿只是草稿 —— 从签名上就能看出来：compileMemoryDraft 不写文件。
 */
import { onMounted, ref } from 'vue'
import { Brain, Eraser, Save, Upload } from 'lucide-vue-next'
import {
  clearBehaviorLog,
  compileMemoryDraft,
  getBehaviorLog,
  getMemory,
  putMemory,
} from '@/services/api/agent-api'

const text = ref('')
const msg = ref('')
const loading = ref(false)
const compiling = ref(false)
const saving = ref(false)
const logStats = ref<Record<string, number>>({})
const added = ref<string[]>([])
const days = ref(14)
const dirty = ref(false)

const KIND_LABEL: Record<string, string> = {
  highlight_explain: '划线解释',
  highlight_summarize: '划线总结',
  add_note: '入笔记',
  classify: '分类',
  retrieve: '检索',
  pin: '钉笔记',
  memory_request: '说「记住 …」',
}

function onEdit(v: string) {
  text.value = v
  dirty.value = true
}

async function load() {
  loading.value = true
  msg.value = ''
  const [mem, log] = await Promise.all([getMemory(), getBehaviorLog(500)])
  loading.value = false
  if (mem.ok) {
    text.value = mem.data?.text || ''
    dirty.value = false
  } else {
    msg.value = `${mem.error}${mem.hint ? ` —— ${mem.hint}` : ''}`
  }
  if (log.ok) logStats.value = log.data?.stats || {}
}

async function compile() {
  compiling.value = true
  msg.value = ''
  const res = await compileMemoryDraft(days.value)
  compiling.value = false
  if (!res.ok) {
    msg.value = res.error || '编译失败'
    return
  }
  const d = res.data!
  added.value = d.added || []
  logStats.value = d.stats || {}
  msg.value = d.added?.length
    ? `从 ${d.events} 条行为里编译出 ${d.added.length} 条。下面是草稿，确认后才写。`
    : `看了最近 ${d.days} 天的 ${d.events} 条行为，还不够构成习惯。`
  if (d.added?.length) {
    text.value = d.draft
    dirty.value = true
  }
}

async function save() {
  saving.value = true
  msg.value = ''
  const res = await putMemory(text.value)
  saving.value = false
  msg.value = res.ok ? '已写入 memory.md。' : `${res.error}`
  if (res.ok) dirty.value = false
}

async function wipeLog() {
  const res = await clearBehaviorLog()
  msg.value = res.ok ? res.data?.note || '日志已清空。' : res.error || '清空失败'
  await load()
}

onMounted(load)
</script>

<template>
  <section>
    <h3 class="mb-2 text-sm font-semibold text-foreground">memory.md（Agent 记习惯用）</h3>
    <p class="mb-3 text-xs leading-relaxed text-muted-foreground">
      这份文件会被塞进每次对话的 system prompt，所以它由 Agent 维护、你可以看。
      <strong>任何写入都要你在这里按确认</strong> —— 不管是你自己改，还是 Agent 说「记住了」，
      还是从行为日志编译出来的草稿。
    </p>

    <div class="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <button class="flex items-center gap-1 text-primary" @click="load">
        <Upload class="h-3 w-3" />读取
      </button>
      <label class="flex items-center gap-1 text-muted-foreground">
        回溯
        <input
          v-model.number="days"
          type="number"
          min="1"
          max="180"
          class="w-16 rounded border border-border bg-secondary/40 px-1 py-0.5"
        />
        天
      </label>
      <button
        class="flex items-center gap-1 text-primary disabled:opacity-50"
        :disabled="compiling"
        @click="compile"
      >
        <Brain class="h-3 w-3" :class="compiling ? 'animate-pulse' : ''" />
        从行为日志编译习惯
      </button>
      <button
        class="flex items-center gap-1 text-muted-foreground hover:text-destructive"
        title="只清行为日志，不动 memory.md，也不动任何笔记"
        @click="wipeLog"
      >
        <Eraser class="h-3 w-3" />清空行为日志
      </button>
      <span v-if="Object.keys(logStats).length" class="text-[10px] text-muted-foreground/70">
        日志：
        <span v-for="(v, k) in logStats" :key="k">{{ KIND_LABEL[String(k)] || k }} {{ v }} · </span>
      </span>
    </div>

    <details v-if="added.length" class="mb-2 rounded-lg border border-border p-2 text-[11px]">
      <summary class="cursor-pointer text-muted-foreground">本次编译新增的条目（{{ added.length }}）</summary>
      <p v-for="(a, i) in added" :key="i" class="mt-1">{{ a }}</p>
    </details>

    <textarea
      :value="text"
      rows="12"
      class="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 font-mono text-xs"
      :disabled="loading"
      @input="onEdit(($event.target as HTMLTextAreaElement).value)"
    />

    <div class="mt-2 flex items-center gap-3">
      <button
        class="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
        :disabled="saving || !dirty"
        @click="save"
      >
        <Save class="h-3.5 w-3.5" />确认写入 memory.md
      </button>
      <span v-if="dirty" class="text-[11px] text-amber-500">有未写入的改动</span>
    </div>

    <p v-if="msg" class="mt-2 text-xs text-muted-foreground">{{ msg }}</p>
  </section>
</template>
