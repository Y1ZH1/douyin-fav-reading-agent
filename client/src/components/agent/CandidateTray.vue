<script setup lang="ts">
/**
 * 候选托盘：Agent 先提案，用户勾选，再钉。
 *
 * 这是产品里最容易被做歪的一处。规格很明确：**检索命中不自动钉进对话**，
 * 只给这一轮用。所以这里的默认动作是「什么都不选」，钉是一个显式动作。
 *
 * `via: 'local'` 表示 Flask 检索没连上，这是本地词面粗筛 —— 必须如实标出来，
 * 不能让它看起来像正经的全文/向量检索结果。
 */
import { computed, ref } from 'vue'
import { AlertTriangle, Check, FolderTree, Pin } from 'lucide-vue-next'
import type { Proposals } from '@/types/agent'

const props = defineProps<{
  proposals: Proposals
  attachedIds: string[]
}>()

const emit = defineEmits<{
  pin: [ids: string[], titles: Record<string, string>]
  mention: [titles: string[]]
  dismiss: []
}>()

const checked = ref<Set<string>>(new Set())

const rows = computed(() => props.proposals.items)
const already = computed(() =>
  new Set(props.attachedIds.filter((id) => rows.value.some((r) => r.awemeId === id))),
)

function toggle(id: string) {
  const next = new Set(checked.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  checked.value = next
}

function titleMap(ids: string[]) {
  const map: Record<string, string> = {}
  for (const r of rows.value) if (ids.includes(r.awemeId)) map[r.awemeId] = r.title
  return map
}

function doPin() {
  const ids = [...checked.value]
  if (!ids.length) return
  emit('pin', ids, titleMap(ids))
  checked.value = new Set()
}

function doMention() {
  const picks = rows.value.filter((r) => checked.value.has(r.awemeId)).map((r) => r.title)
  emit('mention', picks.length ? picks : rows.value.slice(0, 1).map((r) => r.title))
}
</script>

<template>
  <div class="border-t border-border px-2 py-2">
    <div class="mb-1 flex items-start gap-1.5">
      <FolderTree class="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
      <p class="flex-1 text-[11px] leading-relaxed text-muted-foreground">
        搜到 {{ rows.length }} 篇相关笔记。**默认都没钉**，勾选之后才会带进这场对话。
      </p>
      <button class="shrink-0 text-[11px] text-muted-foreground" @click="emit('dismiss')">收起</button>
    </div>

    <p
      v-if="proposals.via === 'local'"
      class="mb-1 flex items-start gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-500"
    >
      <AlertTriangle class="mt-0.5 h-3 w-3 shrink-0" />
      这是本地词面粗筛（Flask 检索没连上），不是全文索引结果。开了转写服务再搜会更准。
    </p>

    <div class="max-h-48 space-y-1 overflow-y-auto">
      <label
        v-for="row in rows"
        :key="row.awemeId"
        class="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-secondary/40"
      >
        <input
          type="checkbox"
          class="mt-0.5 h-3 w-3 shrink-0"
          :checked="checked.has(row.awemeId)"
          @change="toggle(row.awemeId)"
        />
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-1 text-[11px] text-foreground">
            <span class="truncate">{{ row.title }}</span>
            <span v-if="already.has(row.awemeId)" class="shrink-0 text-primary">
              <Check class="inline h-3 w-3" />已钉
            </span>
          </span>
          <span v-if="row.span" class="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {{ row.span }}
          </span>
          <span class="mt-0.5 block text-[10px] text-muted-foreground/70">{{ row.reason }}</span>
        </span>
      </label>
      <p v-if="!rows.length" class="px-1.5 text-[11px] text-muted-foreground">
        候选都钉完了。还想找就再说一句，或者点「收起」。
      </p>
    </div>

    <div class="mt-1.5 flex items-center gap-2">
      <button
        class="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground disabled:opacity-40"
        :disabled="!checked.size"
        @click="doPin"
      >
        <Pin class="h-3 w-3" /> 钉上并 @（{{ checked.size }}）
      </button>
      <button
        class="rounded border border-border px-2 py-1 text-[11px] disabled:opacity-40"
        :disabled="!rows.length"
        @click="doMention"
      >
        只 @ 到输入框
      </button>
    </div>
  </div>
</template>
