<script setup lang="ts">
/**
 * 向量检索面板：状态 / 一键安装 / 卸载 / 重建索引 / 评测。
 *
 * 三条刻意的设计：
 *  1. 装向量是**可选**的。界面上必须先说清「没装也照样能用，只是搜不到
 *     语义相近的说法」，否则用户会以为工具坏了。
 *  2. 安装是长任务（torch 级别），所以走 job + 轮询日志，可随时关掉页面。
 *  3. 评测是自监督造的题（正文里最长的中文片段当 query，期望命中它自己），
 *     不用人工标注，但能真实回答「向量到底有没有帮上忙」。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { Download, FlaskConical, Loader2, RefreshCw, Trash2 } from 'lucide-vue-next'
import {
  evalRetrieve,
  getJob,
  getRetrieveStatus,
  installVector,
  rebuildIndex,
} from '@/services/api/agent-api'
import type { EvalReport, VectorStatus } from '@/types/agent'

const status = ref<VectorStatus | null>(null)
const indexed = ref<number | null>(null)
const msg = ref('')

const installing = ref(false)
const jobId = ref('')
const jobLog = ref<string[]>([])
const jobMsg = ref('')
const jobDone = ref(false)

const rebuilding = ref(false)
const evaluating = ref(false)
const report = ref<EvalReport | null>(null)

async function load() {
  msg.value = ''
  const res = await getRetrieveStatus()
  if (!res.ok) {
    msg.value = `${res.error}${res.hint ? ` —— ${res.hint}` : ''}`
    return
  }
  status.value = res.data?.vector || null
  indexed.value = res.data?.notes_indexed ?? null
}

async function rebuild() {
  rebuilding.value = true
  msg.value = ''
  const res = await rebuildIndex()
  rebuilding.value = false
  msg.value = res.ok ? `索引重建完成，收录 ${res.data?.indexed ?? 0} 篇。` : res.error || '重建失败'
  await load()
}

async function install(uninstall = false) {
  installing.value = true
  jobDone.value = false
  jobLog.value = []
  jobMsg.value = uninstall ? '正在删除向量环境…' : '正在安装（要下 torch，慢）…'
  const res = await installVector(uninstall)
  if (!res.ok || !res.data?.job_id) {
    installing.value = false
    jobMsg.value = res.error || '启动失败'
    return
  }
  jobId.value = res.data.job_id
  poll()
}

let timer: number | undefined

async function poll() {
  if (!jobId.value) return
  const res = await getJob(jobId.value)
  if (!res.ok || !res.data) {
    jobMsg.value = res.error || '读不到任务状态'
    installing.value = false
    return
  }
  const job = res.data
  jobLog.value = job.log || []
  jobMsg.value = job.message || job.current_title || ''
  if (job.status === 'running') {
    timer = window.setTimeout(poll, 1500)
    return
  }
  installing.value = false
  jobDone.value = true
  await load()
}

async function runEval() {
  evaluating.value = true
  report.value = null
  const res = await evalRetrieve()
  evaluating.value = false
  if (!res.ok) {
    msg.value = `${res.error}${res.hint ? ` —— ${res.hint}` : ''}`
    return
  }
  report.value = res.data || null
}

onMounted(load)
onUnmounted(() => {
  if (timer) window.clearTimeout(timer)
})
</script>

<template>
  <section>
    <h3 class="mb-2 text-sm font-semibold text-foreground">检索</h3>
    <p class="mb-3 text-xs leading-relaxed text-muted-foreground">
      默认走全文检索（SQLite FTS）。向量是**可选叠加**：装上以后语义相近的说法也能搜到；
      没装、装坏、加载失败都会静默退回全文检索，不会让「搜不到」变得更多。
    </p>

    <div class="space-y-2 rounded-lg border border-border bg-secondary/20 p-3 text-xs">
      <div class="flex items-center justify-between gap-3">
        <span class="text-muted-foreground">索引收录</span>
        <span>{{ indexed === null ? '未知' : `${indexed} 篇` }}</span>
      </div>
      <div class="flex items-center justify-between gap-3">
        <span class="text-muted-foreground">向量包</span>
        <span :class="status?.installed ? 'text-primary' : 'text-muted-foreground'">
          {{ status?.installed ? `已装 ${status.package_version || ''}` : '未安装（只有全文检索）' }}
        </span>
      </div>
      <div class="flex items-center justify-between gap-3">
        <span class="text-muted-foreground">本地模型</span>
        <span>{{ status?.model || '-' }}{{ status?.model_cached ? '（已缓存）' : '（未缓存）' }}</span>
      </div>
      <div v-if="status?.failed" class="text-amber-500">
        加载失败，已回退全文检索：{{ status.error }}
      </div>
      <p v-if="status?.venv" class="break-all text-[10px] text-muted-foreground/70">
        venv：{{ status.venv }}
      </p>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2">
      <button
        v-if="!status?.installed"
        class="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
        :disabled="installing"
        @click="install(false)"
      >
        <Download class="h-3.5 w-3.5" /> 一键安装向量
      </button>
      <button
        v-else
        class="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50"
        :disabled="installing"
        @click="install(true)"
      >
        <Trash2 class="h-3.5 w-3.5" /> 卸载向量
      </button>
      <button
        class="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50"
        :disabled="rebuilding"
        @click="rebuild"
      >
        <RefreshCw class="h-3.5 w-3.5" :class="rebuilding ? 'animate-spin' : ''" /> 重建索引
      </button>
      <button
        class="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50"
        :disabled="evaluating"
        @click="runEval"
      >
        <Loader2 v-if="evaluating" class="h-3.5 w-3.5 animate-spin" />
        <FlaskConical v-else class="h-3.5 w-3.5" /> 跑评测（FTS vs 向量）
      </button>
      <span class="text-[10px] text-muted-foreground/70">
        用 pip 源 {{ status?.pip_index }} · HF 镜像 {{ status?.hf_endpoint }}
      </span>
    </div>

    <div v-if="installing || jobLog.length" class="mt-3 rounded-lg border border-border p-2">
      <p class="mb-1 flex items-center gap-1 text-xs">
        <Loader2 v-if="installing" class="h-3 w-3 animate-spin" />
        {{ jobMsg || (jobDone ? '结束' : '进行中') }}
      </p>
      <pre class="max-h-48 overflow-y-auto whitespace-pre-wrap break-all text-[10px] text-muted-foreground">{{ jobLog.join('\n') }}</pre>
    </div>

    <div v-if="report" class="mt-3 rounded-lg border border-border p-2 text-xs">
      <template v-if="report.ok">
        <p class="mb-1 text-muted-foreground">
          自监督造题 {{ report.cases }} 道（正文里最长的中文片段当 query，期望命中它自己），top-{{ report.k }}：
        </p>
        <table class="w-full text-[11px]">
          <thead class="text-muted-foreground">
            <tr><th class="w-24 text-left">方法</th><th class="text-left">recall@k</th><th class="text-left">MRR</th><th class="text-left">命中</th></tr>
          </thead>
          <tbody>
            <tr><td>仅 FTS</td><td>{{ report.fts?.recall }}</td><td>{{ report.fts?.mrr }}</td><td>{{ report.fts?.hits }}</td></tr>
            <tr v-if="report.vector">
              <td>FTS + 向量</td><td>{{ report.vector.recall }}</td><td>{{ report.vector.mrr }}</td><td>{{ report.vector.hits }}</td>
            </tr>
          </tbody>
        </table>
        <p class="mt-1 text-muted-foreground">
          {{ report.note }}
          <span v-if="report.delta_recall !== null && report.delta_recall !== undefined">
            · recall 变化 {{ report.delta_recall >= 0 ? '+' : '' }}{{ report.delta_recall }}
          </span>
        </p>
      </template>
      <p v-else class="text-destructive">{{ report.error }}</p>
    </div>

    <p v-if="msg" class="mt-2 text-xs text-muted-foreground">{{ msg }}</p>
  </section>
</template>
