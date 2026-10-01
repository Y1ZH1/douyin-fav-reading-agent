<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { CodeFile } from '@/composables/useExplanation'
import { useExplanation } from '@/composables/useExplanation'
import { detectLanguage } from '@/lib/language-detect'
import { generateId } from '@/lib/utils'
import CodeViewer from './CodeViewer.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
import {
  Sparkles,
  Loader2,
  Plus,
  X,
  FileCode,
  Bug,
  Shield,
  Zap,
  GitBranch,
  BookOpen,
  Upload,
} from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    initialCode?: string
    initialLanguage?: string
  }>(),
  { initialCode: '', initialLanguage: '' },
)

// 分析维度定义
const ANALYSIS_MODES = [
  { id: 'explanation', label: '代码解释', icon: BookOpen, description: '理解代码功能和逻辑' },
  { id: 'review', label: '代码审查', icon: Bug, description: '发现Bug和代码异味' },
  { id: 'architecture', label: '架构分析', icon: GitBranch, description: '分析结构和设计模式' },
  { id: 'optimization', label: '性能优化', icon: Zap, description: '识别性能瓶颈和优化方案' },
  { id: 'security', label: '安全分析', icon: Shield, description: '检查安全漏洞和风险' },
]

// 文件扩展名 → 语言映射
const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', java: 'java', go: 'golang', rs: 'rust',
  cpp: 'cpp', c: 'c', h: 'c', cs: 'csharp', rb: 'ruby',
  php: 'php', swift: 'swift', kt: 'kotlin', scala: 'scala',
  sql: 'sql', html: 'html', css: 'css', scss: 'scss', less: 'less',
  json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml',
  md: 'markdown', sh: 'bash', bash: 'bash', zsh: 'bash',
  vue: 'vue', svelte: 'svelte', astro: 'astro',
  dart: 'dart', lua: 'lua', r: 'r', ex: 'elixir', exs: 'elixir',
}

function extToLang(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return EXT_LANG_MAP[ext] || ''
}

// 文件上传
const fileInput = ref<HTMLInputElement | null>(null)
const isDragOver = ref(false)

function triggerFileUpload() {
  fileInput.value?.click()
}

function handleFiles(selectedFiles: FileList | null) {
  if (!selectedFiles || selectedFiles.length === 0) return

  const newFiles: typeof files.value = []
  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i]
    const reader = new FileReader()
    const fileId = generateId()
    const fileName = file.name

    // 先创建占位文件条目
    newFiles.push({ id: fileId, name: fileName, content: '' })

    reader.onload = (e) => {
      const content = (e.target?.result as string) || ''
      const existing = files.value.find((f) => f.id === fileId)
      if (existing) {
        existing.content = content
      }
      // 自动检测语言
      if (!language.value) {
        const detected = extToLang(fileName)
        if (detected) language.value = detected
      }
    }
    reader.readAsText(file)
  }

  // 替换或追加
  const hasExistingContent = files.value.some((f) => f.content.trim())
  if (!hasExistingContent) {
    // 第一个空文件是默认占位，直接替换
    files.value = newFiles
  } else {
    files.value.push(...newFiles)
  }
  activeFileId.value = newFiles[0].id
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = true
}

function onDragLeave() {
  isDragOver.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  handleFiles(e.dataTransfer?.files || null)
}

// 文件管理
const files = ref<CodeFile[]>([
  { id: generateId(), name: 'main.ts', content: props.initialCode },
])
const activeFileId = ref(files.value[0].id)
const activeFile = computed(() => files.value.find((f) => f.id === activeFileId.value)!)
const language = ref(props.initialLanguage)
const selectedModes = ref<string[]>(['explanation', 'review'])

const { isExplaining, explanationContent, error, analyzeCode, resetExplanation } =
  useExplanation()

// 自动检测语言
const detectedLang = ref('')
watch(
  () => activeFile.value?.content,
  (newCode) => {
    if (!language.value && newCode && newCode.trim().length > 10) {
      detectedLang.value = detectLanguage(newCode)
      if (detectedLang.value) {
        language.value = detectedLang.value
      }
    }
  },
)

watch(language, (newLang) => {
  if (!newLang) detectedLang.value = ''
})

function addFile() {
  const id = generateId()
  const idx = files.value.length + 1
  files.value.push({ id, name: `file${idx}.ts`, content: '' })
  activeFileId.value = id
}

function removeFile(id: string) {
  if (files.value.length <= 1) return
  const idx = files.value.findIndex((f) => f.id === id)
  files.value.splice(idx, 1)
  if (activeFileId.value === id) {
    activeFileId.value = files.value[0].id
  }
}

function toggleMode(modeId: string) {
  const idx = selectedModes.value.indexOf(modeId)
  if (idx === -1) {
    selectedModes.value.push(modeId)
  } else {
    if (selectedModes.value.length > 1) {
      selectedModes.value.splice(idx, 1)
    }
  }
}

function handleAnalyze() {
  const hasContent = files.value.some((f) => f.content.trim())
  if (!hasContent || selectedModes.value.length === 0) return
  resetExplanation()
  const lang = language.value || detectLanguage(activeFile.value?.content || '')
  analyzeCode(files.value, selectedModes.value, lang || undefined)
}

const hasCode = computed(() => files.value.some((f) => f.content.trim()))
</script>

<template>
  <div class="space-y-4">
    <!-- 分析维度选择 -->
    <div>
      <p class="text-xs font-medium text-muted-foreground mb-2">分析维度（可多选）</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="mode in ANALYSIS_MODES"
          :key="mode.id"
          :class="[
            'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all border',
            selectedModes.includes(mode.id)
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'bg-secondary/30 border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50',
          ]"
          @click="toggleMode(mode.id)"
        >
          <component :is="mode.icon" class="h-3.5 w-3.5 shrink-0" />
          <span>{{ mode.label }}</span>
        </button>
      </div>
    </div>

    <!-- 文件标签页 -->
    <div>
      <div class="flex items-center gap-1 mb-1.5 flex-wrap">
        <button
          v-for="file in files"
          :key="file.id"
          :class="[
            'group flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors border',
            file.id === activeFileId
              ? 'bg-secondary border-border text-foreground'
              : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/30',
          ]"
          @click="activeFileId = file.id"
        >
          <FileCode class="h-3 w-3 shrink-0" />
          <input
            v-model="file.name"
            class="w-16 bg-transparent text-xs outline-none"
            @click.stop
          />
          <button
            v-if="files.length > 1"
            class="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5"
            @click.stop="removeFile(file.id)"
          >
            <X class="h-3 w-3 text-muted-foreground hover:text-destructive" />
          </button>
        </button>
        <button
          class="flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          title="添加空文件"
          @click="addFile"
        >
          <Plus class="h-3.5 w-3.5" />
        </button>
        <div class="w-px h-4 bg-border" />
        <button
          class="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          title="从本地文件上传"
          @click="triggerFileUpload"
        >
          <Upload class="h-3 w-3" />
          <span>上传</span>
        </button>
        <input
          ref="fileInput"
          type="file"
          multiple
          accept=".ts,.tsx,.js,.jsx,.py,.java,.go,.rs,.cpp,.c,.h,.cs,.rb,.php,.swift,.kt,.scala,.sql,.html,.css,.scss,.less,.json,.yaml,.yml,.xml,.md,.sh,.bash,.vue,.svelte,.astro,.dart,.lua,.r,.ex,.exs,.txt,.gitignore,.env,.cfg,.ini,.toml,.dockerfile,.makefile"
          class="hidden"
          @change="handleFiles(($event.target as HTMLInputElement).files)"
        />
      </div>

      <!-- 代码输入区 -->
      <div class="flex items-center gap-2 mb-1.5">
        <input
          v-model="language"
          placeholder="语言 (留空自动识别)"
          class="flex-1 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      <div
        :class="[
          'relative rounded-lg border-2 transition-colors',
          isDragOver
            ? 'border-primary/50 bg-primary/5'
            : 'border-transparent',
        ]"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <div
          v-if="isDragOver"
          class="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/10 pointer-events-none"
        >
          <div class="flex flex-col items-center gap-1 text-primary">
            <Upload class="h-6 w-6" />
            <span class="text-xs font-medium">释放文件以上传</span>
          </div>
        </div>
        <textarea
          v-model="activeFile.content"
          :placeholder="activeFile.name + ' - 粘贴代码或拖拽文件到此处...'"
          rows="10"
          class="w-full rounded-lg border border-border bg-secondary/30 px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="flex items-center gap-2">
      <BaseButton
        variant="primary"
        size="sm"
        :disabled="!hasCode || isExplaining || selectedModes.length === 0"
        @click="handleAnalyze"
      >
        <Loader2 v-if="isExplaining" class="h-4 w-4 animate-spin" />
        <Sparkles v-else class="h-4 w-4" />
        {{ isExplaining ? '分析中...' : '分析代码' }}
      </BaseButton>
      <BaseButton
        v-if="explanationContent"
        variant="ghost"
        size="sm"
        @click="resetExplanation"
      >
        清除结果
      </BaseButton>
    </div>

    <!-- 错误提示 -->
    <div
      v-if="error"
      class="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive"
    >
      {{ error }}
    </div>

    <!-- 分析结果 -->
    <div v-if="explanationContent" class="rounded-lg border border-border bg-card p-5">
      <MarkdownRenderer :content="explanationContent" />
    </div>

    <!-- 输入代码预览 -->
    <div v-if="hasCode && !explanationContent" class="pt-2 space-y-3">
      <div
        v-for="file in files.filter((f) => f.content.trim())"
        :key="file.id"
        class="rounded-lg border border-border overflow-hidden"
      >
        <div class="px-3 py-1.5 bg-secondary/30 border-b border-border text-xs text-muted-foreground font-mono">
          {{ file.name }}
        </div>
        <CodeViewer
          :code="file.content"
          :language="language || 'text'"
          :show-line-numbers="true"
        />
      </div>
    </div>
  </div>
</template>
