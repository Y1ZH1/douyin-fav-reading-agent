<script setup lang="ts">
/**
 * 开机自检横幅。
 *
 * 这个工具日常是双进程跑在本机的，「转写服务没开」是最常见的状态，
 * 而它带来的失败长得都很像（列不出收藏夹、检索报错、分类拿不到夹子）。
 * 与其让每处各自 try/catch，不如在顶部把真实状态说清楚。
 */
import { computed } from 'vue'
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-vue-next'
import type { HealthReport } from '@/types/agent'

const props = defineProps<{
  health: HealthReport | null
  checking: boolean
}>()

const emit = defineEmits<{ recheck: []; goto: [route: string] }>()

interface Line {
  tone: 'error' | 'warn' | 'ok'
  text: string
  action?: { label: string; run: () => void }
}

const lines = computed<Line[]>(() => {
  const h = props.health
  if (!h) return []
  const out: Line[] = []

  if (!h.flask.ok) {
    out.push({
      tone: 'error',
      text: `转写服务没开（${h.flask.url}）。收藏夹列表、检索、分类都会失败。`,
      action: {
        label: '我开好了，重试',
        run: () => emit('recheck'),
      },
    })
  } else {
    if (!h.index.built) {
      out.push({
        tone: 'warn',
        text: '检索索引还没建。第一次检索会慢一点，或者点「重建索引」。',
        action: { label: '去设置里重建', run: () => emit('goto', 'settings') },
      })
    }
    if (!h.vector.installed) {
      out.push({
        tone: 'warn',
        text: '向量检索没装，只有全文检索。这不影响使用 —— 装了语义相近的说法才搜得到。',
        action: { label: '一键安装', run: () => emit('goto', 'settings') },
      })
    } else if (h.vector.failed) {
      out.push({
        tone: 'warn',
        text: `向量装了但加载失败，已自动回退全文检索。${h.vector.error || ''}`.trim(),
        action: { label: '查看', run: () => emit('goto', 'settings') },
      })
    }
    if (h.flask.dir && h.vault.dir && h.flask.dir !== h.vault.dir) {
      out.push({
        tone: 'warn',
        text: `两边的笔记库路径不一致：转写服务用 ${h.flask.dir}，Agent 用 ${h.vault.dir}。`,
        action: { label: '去设置', run: () => emit('goto', 'settings') },
      })
    }
    if (h.vault.notes_on_disk === 0) {
      out.push({
        tone: 'warn',
        text: `笔记库里还没转写好的笔记（${h.vault.dir}）。先去转写服务里跑几条。`,
      })
    }
  }
  return out
})

const toneClass: Record<Line['tone'], string> = {
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
  ok: 'border-border bg-secondary/40 text-muted-foreground',
}
</script>

<template>
  <div v-if="lines.length" class="space-y-1 border-b border-border px-3 py-2">
    <div
      v-for="(line, i) in lines"
      :key="i"
      class="flex items-start gap-2 rounded-md border px-2 py-1.5 text-[11px] leading-relaxed"
      :class="toneClass[line.tone]"
    >
      <AlertTriangle v-if="line.tone !== 'ok'" class="mt-0.5 h-3 w-3 shrink-0" />
      <CheckCircle2 v-else class="mt-0.5 h-3 w-3 shrink-0" />
      <span class="flex-1">{{ line.text }}</span>
      <button
        v-if="line.action"
        class="shrink-0 rounded px-1.5 py-0.5 underline decoration-dotted"
        @click="line.action.run()"
      >
        {{ line.action.label }}
      </button>
    </div>
  </div>
  <div
    v-else-if="checking"
    class="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px] text-muted-foreground"
  >
    <RefreshCw class="h-3 w-3 animate-spin" /> 正在检查本机服务…
  </div>
</template>
