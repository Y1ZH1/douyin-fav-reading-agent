<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDiffStore } from '@/stores/diff'
import DiffHunk from './DiffHunk.vue'
import DiffStats from './DiffStats.vue'
import DiffViewToggle from './DiffViewToggle.vue'
import DiffExplanation from './DiffExplanation.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { Sparkles, Trash2, FileCode } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { detectLanguage } from '@/lib/language-detect'

const store = useDiffStore()
const {
  diffFile,
  viewMode,
  isExplaining,
  explanation,
  expandedHunks,
  hasChanges,
  oldCode,
  newCode,
  language,
} = storeToRefs(store)

const oldInput = ref(oldCode.value || '')
const newInput = ref(newCode.value || '')
const langInput = ref(language.value || '')
const detectedLang = ref('')

// 自动检测语言：当两个代码框都有内容时，从较长的那段代码检测
function autoDetectLang() {
  const target = newInput.value.length > oldInput.value.length ? newInput.value : oldInput.value
  if (target.trim().length < 10) return
  const detected = detectLanguage(target)
  if (detected && detected !== detectedLang.value) {
    detectedLang.value = detected
    // 只当用户没手动输入时才自动填充
    if (!langInput.value) {
      langInput.value = detected
    }
  }
}

watch([oldInput, newInput], autoDetectLang)

function handleCompare() {
  if (!oldInput.value && !newInput.value) return
  store.computeDiff(oldInput.value, newInput.value, langInput.value || undefined)
}

function handleExplain() {
  store.fetchExplanation()
}

function handleClear() {
  store.clear()
  oldInput.value = ''
  newInput.value = ''
  langInput.value = ''
  detectedLang.value = ''
}

// ── 示例代码（开头结尾相同，中间有变更） ──
function loadExample() {
  oldInput.value = `import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

export function useUserAuth() {
  const router = useRouter()
  const token = ref(localStorage.getItem('token') || '')
  const user = ref(null)

  async function login(username: string, password: string) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    if (!res.ok) throw new Error('登录失败')
    const data = await res.json()
    token.value = data.token
    user.value = data.user
    localStorage.setItem('token', data.token)
    router.push('/dashboard')
  }

  function logout() {
    token.value = ''
    user.value = null
    localStorage.removeItem('token')
    router.push('/login')
  }

  const isLoggedIn = computed(() => !!token.value)

  return { token, user, login, logout, isLoggedIn }
}`

  newInput.value = `import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

export function useUserAuth() {
  const router = useRouter()
  const token = ref(localStorage.getItem('token') || '')
  const user = ref(null)
  const error = ref<string | null>(null)

  async function login(username: string, password: string) {
    try {
      error.value = null
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      if (!res.ok) {
        const err = await res.json()
        error.value = err.message || '登录失败'
        return
      }
      const data = await res.json()
      token.value = data.token
      user.value = data.user
      localStorage.setItem('token', data.token)
      router.push('/dashboard')
    } catch (e) {
      error.value = e instanceof Error ? e.message : '网络错误'
    }
  }

  function logout() {
    token.value = ''
    user.value = null
    error.value = null
    localStorage.removeItem('token')
    router.push('/login')
  }

  const isLoggedIn = computed(() => !!token.value)

  return { token, user, error, login, logout, isLoggedIn }
}`
}
</script>

<template>
  <div class="diff-viewer h-full flex flex-col">
    <!-- 输入区域 -->
    <div class="px-4 py-4 border-b border-border space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1 block">原始代码</label>
          <textarea
            v-model="oldInput"
            placeholder="粘贴原始代码..."
            rows="6"
            class="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div>
          <label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1 block">修改后代码</label>
          <textarea
            v-model="newInput"
            placeholder="粘贴修改后的代码..."
            rows="6"
            class="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        <input
          v-model="langInput"
          :placeholder="detectedLang || '语言 (留空自动检测)'"
          class="w-40 rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span v-if="detectedLang && !langInput" class="text-[10px] text-primary/60">
          自动检测: {{ detectedLang }}
        </span>
        <BaseButton variant="primary" size="sm" @click="handleCompare">
          比较
        </BaseButton>
        <BaseButton variant="ghost" size="sm" @click="loadExample">
          <FileCode class="h-3.5 w-3.5" />
          加载示例
        </BaseButton>
        <BaseButton
          v-if="hasChanges"
          variant="secondary"
          size="sm"
          :disabled="isExplaining"
          @click="handleExplain"
        >
          <Sparkles class="h-3.5 w-3.5" />
          AI 解释
        </BaseButton>
        <BaseButton
          v-if="diffFile"
          variant="ghost"
          size="sm"
          @click="handleClear"
        >
          <Trash2 class="h-3.5 w-3.5" />
          清除
        </BaseButton>
      </div>
    </div>

    <!-- 差异结果 -->
    <div v-if="diffFile" class="flex-1 flex flex-col min-h-0">
      <!-- 工具栏 -->
      <div class="flex items-center justify-between px-4 py-2 border-b border-border bg-secondary/10">
        <DiffStats :stats="diffFile.stats" />
        <DiffViewToggle :mode="viewMode" @toggle="store.toggleViewMode()" />
      </div>

      <!-- 差异内容 -->
      <div class="flex-1 overflow-y-auto bg-card">
        <div v-if="diffFile.hunks.length === 0" class="flex items-center justify-center h-full">
          <p class="text-sm text-muted-foreground">未发现差异</p>
        </div>
        <div v-else>
          <DiffHunk
            v-for="hunk in diffFile.hunks"
            :key="hunk.id"
            :hunk="hunk"
            :view-mode="viewMode"
            :expanded="expandedHunks.has(hunk.id)"
            @toggle="store.toggleHunk(hunk.id)"
          />
        </div>
      </div>

      <!-- AI 解释面板 -->
      <div v-if="explanation || isExplaining" class="border-t border-border max-h-[300px] overflow-y-auto">
        <DiffExplanation :explanation="explanation" :is-loading="isExplaining" />
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="flex-1 flex items-center justify-center">
      <div class="text-center space-y-2">
        <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/50 mx-auto">
          <span class="text-2xl text-muted-foreground">&plusmn;</span>
        </div>
        <h3 class="text-sm font-medium text-foreground">代码差异查看器</h3>
        <p class="text-xs text-muted-foreground max-w-sm">
          在上面粘贴原始代码和修改后代码，然后点击"比较"以查看 GitHub 风格的高亮差异。
        </p>
      </div>
    </div>
  </div>
</template>
