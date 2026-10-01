<script setup lang="ts">
/**
 * 人机中断卡片。
 *
 * 三种：分类（Jev 低置信）、memory 改写、笔记目标不明。
 * 共同点是「不确认就不动用户的库」——所以卡片上必须有取消/跳过，
 * 而且要能说清为什么要问人（reason 字段），不能只弹一句「请选择」。
 */
import { computed, ref, watch } from 'vue'
import { Sparkles, Tags, Brain } from 'lucide-vue-next'
import type { HitlRequest } from '@/types/agent'

const props = defineProps<{ hitl: HitlRequest }>()

const emit = defineEmits<{
  classify: [action: 'pick' | 'create' | 'skip', folderName?: string]
  memory: [text: string]
  cancel: []
}>()

const draft = ref('')
const newFolder = ref('')

watch(
  () => props.hitl,
  (v) => {
    draft.value = v.current || ''
    newFolder.value = ''
  },
  { immediate: true },
)

const icon = computed(() =>
  props.hitl.kind === 'classify' ? Tags : props.hitl.kind === 'memory' ? Brain : Sparkles,
)

const title = computed(() => {
  if (props.hitl.kind === 'classify') return '需要你选一个收藏夹'
  if (props.hitl.kind === 'memory') {
    return props.hitl.source === 'compiled' ? '从行为日志编译出的习惯，确认才写' : '要改 memory.md，确认才写'
  }
  return '需要确认一下'
})
</script>

<template>
  <div class="m-3 space-y-2 rounded-md border border-border bg-secondary/30 p-2.5 text-xs">
    <div class="flex items-center gap-1.5 font-medium text-foreground">
      <component :is="icon" class="h-3.5 w-3.5 text-primary" />
      {{ title }}
    </div>
    <p class="leading-relaxed text-muted-foreground">{{ hitl.message }}</p>
    <p v-if="hitl.reason" class="text-[11px] text-muted-foreground/80">判定理由：{{ hitl.reason }}</p>

    <!-- 分类 -->
    <template v-if="hitl.kind === 'classify'">
      <div class="flex flex-wrap gap-1">
        <button
          v-for="name in hitl.options || []"
          :key="name"
          class="rounded bg-secondary px-2 py-1 hover:bg-secondary/70"
          :class="name === hitl.suggestion ? 'ring-1 ring-primary' : ''"
          @click="emit('classify', 'pick', name)"
        >
          {{ name }}<span v-if="name === hitl.suggestion" class="ml-1 text-[10px] text-primary">建议</span>
        </button>
      </div>
      <div class="flex items-center gap-1">
        <input
          v-model="newFolder"
          class="w-32 rounded border border-border bg-transparent px-2 py-1"
          placeholder="新建夹名"
        />
        <button
          class="rounded border border-border px-2 py-1 disabled:opacity-40"
          :disabled="!newFolder.trim()"
          @click="emit('classify', 'create', newFolder.trim())"
        >
          新建
        </button>
      </div>
      <button class="text-muted-foreground underline decoration-dotted" @click="emit('classify', 'skip')">
        这次不分类，跳过
      </button>
    </template>

    <!-- memory -->
    <template v-else-if="hitl.kind === 'memory'">
      <p v-if="hitl.added?.length" class="rounded bg-background/60 p-1.5 text-[11px]">
        <span class="text-muted-foreground">本次新增：</span>
        <span v-for="(a, i) in hitl.added" :key="i" class="mt-0.5 block">{{ a }}</span>
      </p>
      <textarea
        v-model="draft"
        rows="8"
        class="w-full rounded border border-border bg-transparent p-1.5 font-mono text-[11px]"
      />
      <div class="flex items-center gap-2">
        <button
          class="rounded bg-primary px-2 py-1 text-primary-foreground"
          @click="emit('memory', draft)"
        >
          确认写入 memory.md
        </button>
        <button class="text-muted-foreground" @click="emit('cancel')">取消</button>
      </div>
      <p class="text-[10px] text-muted-foreground/80">
        memory.md 会被塞进每次对话的 system prompt，所以写之前一定要过一眼。
      </p>
    </template>

    <template v-else>
      <button class="text-muted-foreground underline decoration-dotted" @click="emit('cancel')">知道了</button>
    </template>
  </div>
</template>
