# AI Code Tutor — 代码模式速查

> 入职前必读。按模式分类，展示项目所有关键代码怎么写、为什么这么写。
> 每个模式都包含：**目标 → 代码 → 讲解**

---

## 目录

1. [Pinia Store 写法](#1-pinia-store-写法)
2. [TypeScript 类型定义](#2-typescript-类型定义)
3. [Props / Emit / Slot 传值](#3-props--emit--slot-传值)
4. [Composable 组合式函数](#4-composable-组合式函数)
5. [SSE 流式传输（前端+后端）](#5-sse-流式传输前端后端)
6. [Web Worker 离线程处理](#6-web-worker-离线程处理)
7. [持久化：localStorage 双轨](#7-持久化localstorage-双轨)
8. [工具函数封装](#8-工具函数封装)
9. [路由懒加载 + 导航](#9-路由懒加载--导航)
10. [后端：Express + SSE + 安全过滤](#10-后端express--sse--安全过滤)
11. [AsyncGenerator 异步生成器](#11-asyncgenerator-异步生成器)
12. [Markdown 渲染：Worker + 主线程双通道](#12-markdown-渲染worker--主线程双通道)
13. [Shiki 代码高亮 + LRU 缓存](#13-shiki-代码高亮--lru-缓存)
14. [Zod Schema 校验 + JSON 修复](#14-zod-schema-校验--json-修复)
15. [全局浮层组件（Teleport）](#15-全局浮层组件teleport)
16. [CSS 变量主题系统](#16-css-变量主题系统)
17. [组件组合——Diff 7 层组件树](#17-组件组合diff-7-层组件树)

---

## 1. Pinia Store 写法

### 目标
管理全局状态，比如聊天消息、设置、UI 状态。

### 代码

**最小 store（settings.ts）：**
```ts
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  // state — 用 ref 定义
  const settings = ref<AppSettings>(loadSettings())

  // 自动持久化：settings 变化时写入 localStorage
  watch(settings, (val) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val))
  }, { deep: true })

  // actions — 普通函数
  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    settings.value[key] = value
  }

  function reset() {
    settings.value = getDefaultSettings()
  }

  // 返回暴露的接口
  return { settings, update, reset }
})
```

**复杂 store（chat.ts）：**
```ts
export const useChatStore = defineStore('chat', () => {
  // ── state ──
  const sessions = ref<ChatSession[]>([])
  const activeSessionId = ref<string | null>(null)
  const isGenerating = ref(false)
  const abortController = ref<AbortController | null>(null)

  // ── getters（用 computed）──
  const activeSession = computed(() =>
    sessions.value.find((s) => s.id === activeSessionId.value) ?? null,
  )
  const activeMessages = computed(() => activeSession.value?.messages ?? [])

  // ── actions ──
  function addMessage(role: 'user' | 'assistant', content: string) {
    // 创建消息对象 → push 到 session.messages → 持久化
  }

  async function updateMessageStatus(id: string, status: MessageStatus) {
    // 更新消息状态 → 持久化
  }

  return {
    sessions, activeSessionId, isGenerating,
    activeSession, activeMessages,
    addMessage, createStreamingMessage, updateMessageStatus,
    // ...
  }
})
```

### 讲解

| 概念 | Vue Options API 对比 | Pinia Setup Store |
|---|---|---|
| state | `data()` | `ref()` / `reactive()` |
| getter | `computed: {}` | `computed()` |
| mutation | `methods: { commit() }` | 没有 mutation，直接修改 |
| action | `actions: {}` | 普通函数（async 也行） |

**关键规则：**
- `defineStore('唯一id', () => { ... })` — 第一个参数是 store ID，全局唯一
- 返回的对象就是 store 暴露的接口
- 在组件里用 `const store = useChatStore()` 获取
- 解构时要用 `storeToRefs(store)` 保持响应性：
  ```ts
  const { sessions, activeSessionId } = storeToRefs(useChatStore())
  // 如果直接 const { sessions } = useChatStore() 会丢失响应式
  ```
- actions 直接是普通函数，不需要 `dispatch`

---

## 2. TypeScript 类型定义

### 目标
定义项目里所有数据的形状，让编辑器能提供类型提示和检查。

### 代码

```ts
// types/chat.ts
export type MessageStatus = 'pending' | 'sending' | 'streaming' | 'done' | 'error' | 'aborted'
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  id: string
  sessionId?: string
  role: MessageRole
  content: string
  reasoningContent?: string    // DeepSeek 的思考过程
  timestamp: number
  status: MessageStatus
  metadata?: MessageMetadata
  parentId?: string            // 消息分支用
  childrenIds?: string[]
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  pinned: boolean
  messageCount: number
}

// types/diff.ts
export interface DiffLine {
  id: string
  type: 'add' | 'delete' | 'context' | 'header'
  oldLineNumber?: number
  newLineNumber?: number
  content: string
  wordChanges?: WordChange[]
}

export interface DiffHunk {
  id: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

// types/index.ts — 统一导出 + 跨类型公用定义
export * from './chat'
export * from './diff'
export * from './code'

export interface AppSettings {
  theme: 'dark' | 'light'
  fontSize: 'small' | 'medium' | 'large'
  showLineNumbers: boolean
  autoScroll: boolean
  apiKey: string
  model: string
  language: 'zh' | 'en' | 'auto'
}
```

### 讲解

**三条经验：**

1. **`type` 用于联合类型，`interface` 用于对象类型** — 这是行业惯例
2. **可选字段用 `?`** — 比如 `sessionId?: string` 表示这个字段不一定存在
3. **`index.ts` 统一 `export *`** — 其他文件只需要 `import { ChatMessage } from '@/types'`，不需要关心具体在哪个文件

**设计原则：** 类型定义放在 `types/` 目录，不属于任何组件。数据流里经过的所有对象都应该有类型定义。这样 VSCode 会给你自动补全和编译时检查。

---

## 3. Props / Emit / Slot 传值

### 目标
父子组件通信。三种方式各什么时候用。

### 代码

**Props — 父传子：**
```vue
<!-- 子组件：ChatMessage.vue -->
<script setup lang="ts">
// 方式 A：简单声明
defineProps<{ message: ChatMessageType }>()

// 方式 B：带默认值
const props = withDefaults(
  defineProps<{
    code: string
    language?: string
    showCopy?: boolean
  }>(),
  { language: 'text', showLineNumbers: true },
)
</script>

<!-- 父组件使用 -->
<ChatMessage :message="msg" />
```

**Emit — 子传父：**
```vue
<!-- 子组件 -->
<script setup lang="ts">
const emit = defineEmits<{
  send: [content: string]     // emit('send', 'hello')
  stop: []                    // emit('stop')
  regenerate: [id: string]    // emit('regenerate', msg.id)
}>()

function handleSubmit() {
  emit('send', inputText.value)
}
</script>

<!-- 父组件监听 -->
<ChatInput @send="handleSend" @stop="stopGeneration" />
```

**Slot — 插入内容占位：**
```vue
<!-- BaseButton.vue -->
<template>
  <button :class="cn(...)">
    <slot />      <!-- 使用组件的父级插入的内容会显示在这里 -->
  </button>
</template>

<!-- 使用 -->
<BaseButton variant="primary">
  <Sparkles class="h-4 w-4" />
  分析代码
</BaseButton>
```

**v-model（双向绑定）：**
```vue
<!-- 父组件 -->
<ChatInput v-model="inputText" />

<!-- 子组件 ChatInput.vue （用 props + emit 实现） -->
<script setup>
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}
</script>
```

### 讲解

| 方式 | 方向 | 使用场景 |
|---|---|---|
| **Props** | 父 → 子 | 传数据、配置项 |
| **Emit** | 子 → 父 | 通知父组件做某事（点击、提交、关闭） |
| **Slot** | 父 → 子（内容） | 按钮文字、列表项、可复用的骨架 |
| **v-model** | 双向 | 表单输入、对话框开关 |

**实用经验：**
- `defineProps` 和 `defineEmits` 是**编译宏**，不需要 import
- TypeScript 泛型写法 `<{ message: type }>` 提供类型检查
- `withDefaults` 给可选 props 设默认值
- Slot 可以用 `<slot name="header" />` 定义具名插槽，`<template #header>内容</template>` 使用

---

## 4. Composable 组合式函数

### 目标
把组件里的逻辑抽出来复用，所有响应式数据在 composable 内部管理。

### 代码

```ts
// composables/useChat.ts
import { ref, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore } from '@/stores/chat'
import { streamChat } from '@/services/ai'

export function useChat() {
  // 引用 store
  const store = useChatStore()
  const { sessions, activeSessionId, isGenerating, activeMessages: messages } = storeToRefs(store)

  // 组件内部的状态
  const error = ref<string | null>(null)

  // 生命周期钩子
  onMounted(() => {
    store.initDB()
  })

  // 业务逻辑
  async function sendMessage(content: string) {
    // ... 调用 streamChat，处理 SSE 流，更新 store
  }

  function stopGeneration() {
    store.abortController?.abort()
  }

  // 返回给组件使用的接口
  return {
    error,
    sendMessage,
    stopGeneration,
    sessions,
    activeSessionId,
    isGenerating,
    messages,
  }
}
```

**在组件中使用：**
```vue
<!-- ChatArea.vue -->
<script setup lang="ts">
import { useChat } from '@/composables/useChat'

const { sendMessage, stopGeneration, isGenerating, messages, error } = useChat()

function handleSend(content: string) {
  sendMessage(content)
}
</script>
```

### 讲解

**Composable 的核心规则：**

1. **`useXxx` 命名** — 文件名和导出函数名一致
2. **内部管理自己的 reactive 状态** — `ref`、`reactive`、生命周期钩子都在里面
3. **职责单一** — `useChat` 管聊天，`useExplanation` 管代码解释，`useCodeHighlight` 管高亮
4. **不依赖组件** — composable 只是函数，可以在任何组件里调用
5. **模块级单例** — 像 `useSelectionExplain` 共享状态，模块顶层的 `ref` 是所有调用者共享的

**项目和 Vue 2 的最大区别（也是面试常问）：**
- Vue 2 的 mixin：属性来源不清晰，命名冲突
- Vue 3 的 composable：就是普通函数，从哪里来、用了什么 ref，一目了然

---

## 5. SSE 流式传输（前端+后端）

### 目标
实现 AI 流式响应：后端一边生成，前端一边显示。

### 前端：`services/ai/stream-parser.ts`

```ts
export interface StreamChunk {
  content?: string      // 普通内容
  reasoning?: string    // DeepSeek 的思考内容
}

export async function* parseSSEStream(response: Response): AsyncGenerator<StreamChunk> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return

      try {
        const parsed = JSON.parse(data)
        if (parsed.content) yield { content: parsed.content }
        if (parsed.reasoning) yield { reasoning: parsed.reasoning }
      } catch { /* 跳过无效行 */ }
    }
  }
}
```

### 前端：`services/ai/client.ts`

```ts
export async function* streamChat(
  messages: { role: string; content: string }[],
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  // 超时控制：120 秒
  const timeoutController = new AbortController()
  const timeoutTimer = setTimeout(() => timeoutController.abort(), 120_000)

  // 外部 signal 和内部超时信号链接
  if (signal) {
    signal.addEventListener('abort', () => timeoutController.abort(), { once: true })
  }

  try {
    const response = await fetch(`/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...getSettings() }),
      signal: timeoutController.signal,
    })

    if (!response.ok) throw new Error(`请求失败 (${response.status})`)

    // 重点：yield* 代理给 parseSSEStream
    yield* parseSSEStream(response)
  } finally {
    clearTimeout(timeoutTimer)
  }
}
```

### 后端：`routes/chat.ts`

```ts
chatRouter.post('/stream', (req, res) => {
  // 1. 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')  // 禁用 Nginx 缓冲
  res.flushHeaders()

  // 2. 调用 AI 服务，每收到一个 chunk 就写入 response
  streamChatCompletion(
    { messages: [systemMsg, ...userMessages], apiKey, model, replyLanguage },
    (chunk) => {
      if (res.writable) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`)  // SSE 格式
      }
    },
  )
    .then(() => {
      res.write('data: [DONE]\n\n')  // 结束标记
      res.end()
    })
    .catch((error) => {
      res.write(`data: ${JSON.stringify({ error })}\n\n`)
      res.end()
    })
})
```

### 讲解

**SSE 全链路：**

```
用户发送消息
  → useChat.sendMessage()
  → 用 for await...of 消费 streamChat() 的 AsyncGenerator
  → 每次 yield 出一个 chunk，调用 store.appendToMessage() 更新 UI
  → 前端 fetch POST 到后端 /api/chat/stream
  → 后端调用 AI API（https.request 原始请求）
  → AI 流式返回 → 后端逐行解析 → res.write() 推回前端
  → 前端 ReadableStream.getReader() 逐行读取
```

**关键点：**
- 前端不用 EventSource（只支持 GET），而是用 `fetch` + `ReadableStream`
- `AsyncGenerator` 让调用方可以用 `for await...of` 消费，代码像同步一样
- 超时链：外部 AbortSignal + 内部 120s 定时器，任一触发即取消
- `yield*` 把 `parseSSEStream` 的生成器代理到外层

---

## 6. Web Worker 离线程处理

### 目标
把 Markdown 解析放到 Worker 线程，不阻塞主线程 UI。

### Worker：`workers/markdown.worker.ts`

```ts
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
// 配置插件：KaTeX、自定义容器、diff 块等

// Worker 的唯一入口：接收消息，处理，返回
self.onmessage = (e: MessageEvent<{ id: string; content: string }>) => {
  const { id, content } = e.data
  const html = md.render(content)
  self.postMessage({ id, html })
}
```

### 主线程管理：`composables/useWorkerMarkdown.ts`

```ts
let worker: Worker | null = null
const pending = new Map<string, { resolve, reject }>()

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(
    new URL('@/workers/markdown.worker.ts', import.meta.url),
    { type: 'module' },  // Worker 也支持 ESM
  )

  worker.onmessage = (e) => {
    const { id, html, error } = e.data
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    if (error) entry.reject(new Error(error))
    else entry.resolve(html || '')
  }

  worker.onerror = (err) => {
    // Worker 崩溃：拒绝所有等待的 Promise，重建 Worker
    for (const [id, entry] of pending) {
      entry.reject(new Error('Worker crashed'))
      pending.delete(id)
    }
    worker?.terminate()
    worker = null
  }

  return worker
}

export async function renderInWorker(content: string): Promise<string> {
  const id = generateId()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try {
      getWorker().postMessage({ id, content })  // 发送给 Worker
    } catch (err) {
      pending.delete(id)
      reject(err)
    }
  })
}

export function terminateWorker(): void {
  worker?.terminate()
  worker = null
  // 拒绝所有 pending
}
```

### 讲解

**Worker 工作模式：**

```
主线程                           Worker 线程
   │                                │
   ├─ postMessage({id, content}) ──→  │
   │                                ├─ md.render(content)
   │                                ├─ postMessage({id, html})
   │  ←────────────────────────────  │
   │                                │
   Promise.resolve(html)             │
```

**设计决策：**
- **单例 Worker** — 整个应用只创建一个 Worker 实例，减少资源开销
- **Promise 映射** — 每次调用生成唯一 ID，Worker 返回时带上 ID，主线程通过 `pending Map` 找到对应的 resolve
- **崩溃恢复** — Worker 报错时终止并置为 null，下次调用重新创建
- **降级策略** — `useMarkdown.ts` 中如果 Worker 失败，回退到主线程渲染（手动 import markdown-it）

---

## 7. 持久化：localStorage 双轨

### 目标
聊天数据存两份：localStorage 负责即时恢复，IndexedDB 负责完整备份。

### localStorage 主存储

```ts
const SESSIONS_KEY = 'ai-tutor:sessions'
const MESSAGES_PREFIX = 'ai-tutor:msgs:'
const MAX_MESSAGES_PER_SESSION = 20

export function saveSession(session: ChatSession): void {
  // 1. 深度去除 Vue 响应式代理
  const plain = JSON.parse(JSON.stringify(toRaw(session)))
  const { messages, ...meta } = plain

  // 2. 只保留最近 20 条消息
  const recentMessages = messages.slice(-MAX_MESSAGES_PER_SESSION)

  // 3. 写入 localStorage
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
  localStorage.setItem(MESSAGES_PREFIX + session.id, JSON.stringify(recentMessages))
}
```

### IndexedDB 备份

```ts
import { openDB } from 'idb'

export async function getDB() {
  return openDB('ai-code-tutor-pro', 3, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      // 版本升级时创建/更新 store
      if (oldVersion < 1) {
        database.createObjectStore('sessions', { keyPath: 'id' })
        database.createObjectStore('messages', { keyPath: 'id' })
      }
    },
  })
}

export async function persistMessage(message: ChatMessage) {
  const database = await getDB()
  await database.put('messages', message)
}
```

### Store 初始化逻辑

```ts
async function initDB() {
  // 先读 localStorage（同步，快）
  const lsSessions = lsLoadAllSessions()
  if (lsSessions.length > 0) {
    sessions.value = lsSessions
    activeSessionId.value = sessions.value[0]?.id
    dbReady.value = true
    recoverInterrupted()
    initIDBBackfill()  // 后台用 IDB 回填
    return
  }

  // localStorage 没有 → 从 IndexedDB 恢复
  const saved = await idbGetAllSessions()
  if (saved.length > 0) {
    sessions.value = saved
    // 回填到 localStorage
    for (const s of sessions.value) {
      lsSaveSession(s)
    }
  }
}
```

### 讲解

**为什么不用一个存全部？**

| | localStorage | IndexedDB |
|---|---|---|
| 读写 | 同步 | 异步 |
| 容量 | ~5MB | 通常 > 50MB |
| 查询 | 只能按 key | 支持索引（按 sessionId 查） |
| 适合 | 少量数据快速读写 | 大量数据、复杂查询 |

**策略：**
```
用户操作 → localStorage（同步写入，UI 即时可读）
         → IndexedDB（异步备份，fire-and-forget）
页面加载 → 先读 localStorage（100ms 内显示）
         → IndexedDB 回填（后台补充完整数据）
```

**配额保护：** `ensureQuota()` 在 localStorage 接近 5MB 时自动驱逐最旧的 unpinned 会话。

---

## 8. 工具函数封装

### 目标
把重复的逻辑抽成纯函数，不依赖 Vue，到处可用。

### 代码

```ts
// lib/utils.ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// 合并 Tailwind class（条件式 class 处理）
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 生成唯一 ID（时间戳 + 随机字符串）
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// 格式化时间戳
export function formatTimestamp(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts)
}
```

```ts
// lib/lru-cache.ts — LRU 缓存
export class LRUCache<T> {
  private maxSize: number
  private cache = new Map<string, { value: T; timestamp: number }>()

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    this.cache.delete(key)
    this.cache.set(key, entry)  // 移到末尾（最近使用）
    return entry.value
  }

  set(key: string, value: T): void {
    if (this.cache.has(key)) this.cache.delete(key)
    else if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value  // Map 的迭代器按插入顺序
      if (oldest) this.cache.delete(oldest)
    }
    this.cache.set(key, { value, timestamp: Date.now() })
  }
}
```

```ts
// lib/language-detect.ts — 语言检测
const LANGUAGE_PATTERNS: [string, RegExp][] = [
  ['typescript', /\b(interface|type)\s+\w+\s*[=({]|:\s*(string|number|boolean)\b/],
  ['python', /\bdef\s+\w+\s*\(|import\s+\w+|print\(/],
  ['go', /\bpackage\s+main\b|\bfunc\s+\w+\s*\(|fmt\./],
  // ... 20+ 语言模式
]

export function detectLanguage(code: string): string {
  if (!code?.trim()) return ''
  let bestLang = ''
  let bestScore = 0
  for (const [lang, pattern] of LANGUAGE_PATTERNS) {
    const matches = code.match(new RegExp(pattern.source, 'gm'))
    const score = matches ? matches.length : 0
    if (score > bestScore) { bestScore = score; bestLang = lang }
  }
  return bestScore > 0 ? bestLang : ''
}
```

### 讲解

**封装原则：**
1. 不 import 任何 Vue/Pinia 的东西
2. 输入明确，输出明确，没有副作用（pure function）
3. 一个文件一个职责
4. 所有函数都导出，按需使用

`cn()` 这个函数尤其常见——它合并 Tailwind class，处理条件式 class 的冲突。比如 `cn('px-4', isActive && 'bg-blue-500')`，如果 `isActive` 为 false，第二个 class 就不会出现。

---

## 9. 路由懒加载 + 导航

### 目标
页面级别的代码分割，用户访问时才下载。

### 代码

```ts
// router/index.ts
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),         // 使用 history 模式，没有 # 号
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),  // lazyload!
    },
    {
      path: '/diff',
      name: 'diff',
      component: () => import('@/views/DiffView.vue'),
    },
    // ...
  ],
})

export { router }
```

**两种导航方式：**
```ts
// 声明式（模板里）
<router-link :to="{ name: 'diff' }">差异查看器</router-link>

// 编程式（script 里）
const router = useRouter()
router.push({ name: 'diff' })
router.push('/diff')
```

### 讲解

- `() => import(...)` 是动态 import，Vite 自动拆包为独立的 JS chunk
- `createWebHistory()` 使用 HTML5 History API，URL 里没有 `#`
- 组件被 Router 匹配到时自动渲染到 `<RouterView />` 的位置
- 路由参数 `name` 比 `path` 好——路径变了也不用改代码

---

## 10. 后端：Express + SSE + 安全过滤

### 目标
后端的整体结构和 AI 调用方式。

### 入口

```ts
// server/src/index.ts
import 'dotenv/config'
import express from 'express'

const app = express()
app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json({ limit: '10mb' }))

app.use('/api/chat', chatRouter)
app.use('/api/explanation', explanationRouter)
app.use('/api/diff', diffRouter)
app.use('/api/analyze', analyzeRouter)

app.listen(3001)
```

### AI 调用（纯原生，不用 SDK）

```ts
// server/src/services/ai.ts
export function streamChatCompletion(
  request: ChatCompletionRequest,
  onChunk: (chunk: StreamChunk) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.deepseek.com',
        path: '/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        let buffer = ''
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim().startsWith('data:')) continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') { resolve(); return }

            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta
            if (delta?.content) onChunk({ content: delta.content })
            if (delta?.reasoning_content) onChunk({ reasoning: delta.reasoning_content })
          }
        })
      },
    )
    req.write(JSON.stringify(payload))
    req.end()
  })
}
```

### 安全过滤

```ts
// server/src/services/safety.ts
// 三层防护：

// 第一层：System Prompt 禁止指令
export const SAFETY_GUIDELINES = `...作为AI代码导师，你必须...`

// 第二层：输入正则拦截
const INPUT_BLOCK_PATTERNS = [
  /(如何\s*)?(生成|制作|创建)\s*(色情|淫秽|病毒|木马).*/i,
  /(DAN|do\s+anything\s+now|jailbreak|越狱)/i,
  // ...16 个模式
]

// 第三层：输出扫描
const OUTPUT_WARNING_PATTERNS = [
  /(色情|淫秽|病毒|木马|黑客攻击|非法)/i,
]
```

### 讲解

后端不复杂，就是**收到请求 → 调 AI → 流式返回**。
- 使用原生 `https.request` 不用 OpenAI SDK——目的是厂商无关，DeepSeek/OpenAI/通义千问只要接口兼容都能用
- 用户传入的 `apiKey` / `model` / `replyLanguage` 覆盖 `.env` 配置
- 所有 4 个路由都共用 `streamChatCompletion`，只是拼装不同的 System Prompt

---

## 11. AsyncGenerator 异步生成器

### 目标
让调 AI 流式接口的代码像同步循环一样简单。

### 代码

```ts
// 定义：返回 AsyncGenerator 的函数
export async function* streamChat(
  messages: { role: string; content: string }[],
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const response = await fetch(...)
  yield* parseSSEStream(response)  // 代理给另一个 AsyncGenerator
}

// 使用：消费方
async function sendMessage(content: string) {
  try {
    // for await...of 自动等待每个 yield
    for await (const chunk of streamChat(messages, controller.signal)) {
      if (chunk.content) store.appendToMessage(msg.id, chunk.content)
      if (chunk.reasoning) store.appendReasoningToMessage(msg.id, chunk.reasoning)
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      // 用户取消了请求
    }
  }
}
```

### 讲解

**对比两种模式：**

| 模式 | 代码复杂度 | 控制权 |
|---|---|---|
| callback: `onChunk((data) => { ... })` | 简单，但不支持 `break`/`return` | 在回调函数里 |
| AsyncGenerator: `for await...of` | 看起来像同步代码 | 在调用方 |

**核心：** `yield` 暂停执行，`yield*` 代理给另一个生成器。这样 `parseSSEStream` 每解析出一行数据就 `yield` 一次，`streamChat` 不做额外处理、直接用 `yield*` 透传出去。消费方的 `for await...of` 每次拿到一个 chunk，拼接内容、更新 UI。

---

## 12. Markdown 渲染：Worker + 主线程双通道

### 目标
AI 返回的 Markdown 内容渲染成 HTML，优先走 Worker，失败回退主线程。

### 代码

```ts
// composables/useMarkdown.ts
export function useMarkdown(content: Ref<string>, theme?: Ref<'dark' | 'light'>) {
  const html = ref('')
  const loading = ref(true)

  watch(content, async (newContent) => {
    if (!newContent) return
    loading.value = true
    try {
      // 优先 Worker 渲染
      const rawHtml = await renderInWorker(newContent)
      // 主线程后处理：Shiki 高亮代码块
      html.value = await postProcessWithShiki(rawHtml)
    } catch {
      try {
        // Worker 失败 → 主线程渲染（手动 import markdown-it）
        const md = await getMarkdownInstance()
        html.value = md.render(newContent)
      } catch {
        // 都失败 → 保留之前的内容
      }
    }
    loading.value = false
  }, { immediate: true })

  return { html, loading }
}
```

### 讲解

**三阶降级：**
```
Worker 渲染（最快，不阻塞 UI）
  → 失败 → 主线程渲染（带 Shiki 高亮）
    → 失败 → 保留前次内容（不显示空白）
```

**为什么不用纯 Worker 渲染完事？**
因为 Shiki 高亮必须在主线程运行（Web Worker 不支持 DOM 操作 + Shiki 包太大）。所以 Worker 只做 markdown-it 解析，主线程拿到 HTML 后，用正则找到 `<code class="language-xxx">` 块，逐个用 Shiki 高亮替换。

---

## 13. Shiki 代码高亮 + LRU 缓存

### 目标
给代码块上专业语法高亮，同时避免重复计算。

### 代码

```ts
// composables/useCodeHighlight.ts
import type { Highlighter } from 'shiki'
import { LRUCache } from '@/lib/lru-cache'

let highlighterInstance: Highlighter | null = null
const highlightCache = new LRUCache<string>(200)  // LRU 缓存，最多 200 条

export function useCodeHighlight() {
  async function initHighlighter(): Promise<Highlighter> {
    if (highlighterInstance) return highlighterInstance
    // 动态 import — shiki 只在需要高亮时才加载
    const { createHighlighter } = await import('shiki')
    highlighterInstance = await createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: ['typescript', 'javascript', 'python', ...],  // 预加载核心语言
    })
    return highlighterInstance
  }

  async function highlightCode(
    code: string,
    lang: string,
    theme: 'github-dark' | 'github-light' = 'github-dark',
  ): Promise<string> {
    const cacheKey = `${theme}:${lang}:${code.slice(0, 200)}:${code.length}`
    const cached = highlightCache.get(cacheKey)
    if (cached) return cached  // 命中缓存，直接返回

    await ensureLang(lang)  // 按需加载语言
    const hl = await initHighlighter()
    const result = hl.codeToHtml(code, { lang, theme })
    highlightCache.set(cacheKey, result)
    return result
  }

  return { getHighlighter, initHighlighter, highlightCode }
}
```

### 讲解

| 技术 | 解决什么问题 |
|---|---|
| **动态 import** | shiki 包很大（~5MB），只在首次需要高亮时才加载 |
| **预加载核心语言** | TS/JS/Python/HTML/CSS 最多用，提前加载 |
| **按需加载扩展语言** | Rust/Go/Vue 等用到时才 `hl.loadLanguage()` |
| **LRU 缓存** | 同样的代码高亮结果不重复计算，200 条上限防内存溢出 |

---

## 14. Zod Schema 校验 + JSON 修复

### 目标
AI 返回的 JSON 格式不保证正确，需要校验 + 修复。

### 代码

```ts
// schemas/explanation.schema.ts
import { z } from 'zod'

export const AIExplanationSchema = z.object({
  summary: z.string(),
  sections: z.array(z.object({
    hunkId: z.string(),
    title: z.string(),
    detail: z.string(),
    severity: z.enum(['info', 'warning', 'critical']),
    learningPoints: z.array(z.string()).optional(),
  })),
})
```

```ts
// services/parser/json-validator.ts
export function validateAIExplanation(raw: string) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // JSON 解析失败 → 尝试修复
    const fixed = aiErrorRecovery.repair(raw)
    parsed = JSON.parse(fixed)
  }

  const result = AIExplanationSchema.safeParse(parsed)
  if (result.success) return { success: true, data: result.data }
  return { success: false, errors: result.error.issues }
}

// 从 Markdown 中提取 JSON 块
export function extractJSONFromMarkdown(markdown: string): string | null {
  // 匹配 ```json ... ``` 代码块
  const jsonBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/g
  const matches = [...markdown.matchAll(jsonBlockRegex)]
  if (matches.length > 0) return matches[matches.length - 1][1].trim()
  // 没有代码块 → 尝试直接找 { ... }
  const braceMatch = markdown.match(/\{[\s\S]*\}/)
  return braceMatch ? braceMatch[0] : null
}
```

```ts
// services/ai/error-recovery.ts — JSON 修复器
export class AIErrorRecovery {
  repair(raw: string): string {
    let fixed = raw
    fixed = this.closeUnterminated(fixed)       // 闭合未闭合的 {} []
    fixed = this.trimIncompleteTrailingProperty(fixed) // 去掉末尾不完整的属性
    fixed = fixed
      .replace(/,\s*}/g, '}')   // 去掉多余的逗号
      .replace(/,\s*\]/g, ']')
      .replace(/,\s*,/g, ',')
    return fixed
  }
}
```

### 讲解

```
AI 返回 Markdown → extractJSONFromMarkdown 提取 JSON
  → JSON.parse 解析 → 失败 → AIErrorRecovery.repair 修复 → 再解析
  → Zod safeParse 校验结构 → 失败 → degrade 降级（去掉无效字段）
  → 成功 → 使用数据
```

为什么需要这套？因为 AI 经常会返回格式小错误——多余的逗号、没闭合的括号、嵌在 Markdown 里等。写代码来处理这些边缘情况，比期待 AI 每次都输出正确 JSON 更靠谱。

---

## 15. 全局浮层组件（Teleport）

### 目标
组件渲染到 DOM 树的其他位置（比如 body），而不是在组件层级里。

### 代码

```vue
<!-- CommandPalette.vue — Cmd+K 全局命令面板 -->
<template>
  <Teleport to="body">     <!-- 渲染到 <body> 下 -->
    <div v-if="uiStore.commandPaletteOpen" class="fixed inset-0 z-[100]">
      <div class="fixed inset-0 bg-black/50" @click="uiStore.commandPaletteOpen = false" />
      <div class="relative w-full max-w-lg bg-card border rounded-xl shadow-2xl">
        <input v-model="search" placeholder="输入命令..." />
        <button v-for="cmd in filtered" @click="executeCommand(cmd)">
          ...
        </button>
      </div>
    </div>
  </Teleport>
</template>
```

```vue
<!-- App.vue — 全局挂载（不阻塞路由渲染） -->
<script setup>
const CommandPalette = defineAsyncComponent(
  () => import('@/components/layout/CommandPalette.vue'),
)
</script>
<template>
  <RouterView />
  <CommandPalette />     <!-- 在 App 层级渲染，不受路由影响 -->
</template>
```

### 讲解

`<Teleport to="body">` 把组件渲染到 body 下，即使组件在深层嵌套里：

```
组件树：App.vue → RouterView → HomeView → ChatArea
                      ↓ Teleport
DOM树：<body>
         <div id="app">...</div>
         <div class="fixed"> ← 命令面板在这里，不受父组件 overflow:hidden 影响
       </body>
```

这样 modal、tooltip、命令面板不会被父组件的 `overflow: hidden` 或 `z-index` 限制。

**加上 `defineAsyncComponent`**：CommandPalette 不是每个页面都需要，懒加载减少首屏包体积。

---

## 16. CSS 变量主题系统

### 目标
用 CSS 变量实现亮/暗主题切换，Tailwind 消费这些变量。

### 代码

```css
/* assets/main.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    --primary: 217 91% 60%;
    --secondary: 0 0% 96%;
    --border: 0 0% 90%;
  }

  .dark {
    --background: 0 0% 3.9%;
    --foreground: 0 0% 98%;
    --primary: 217 91% 60%;
    --secondary: 0 0% 12%;
    --border: 0 0% 14.9%;
  }

  * { @apply border-border; }
  body {
    @apply bg-background text-foreground;
  }
}
```

```ts
// tailwind.config.ts 中配置 CSS 变量映射
// theme.extend.colors 里把 CSS 变量映射为 Tailwind 颜色类
```

**切换主题（App.vue）：**
```ts
watch(() => settings.value.theme, (theme) => {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}, { immediate: true })
```

### 讲解

- `:root` 下的变量是亮色主题，`.dark` 下的变量覆盖为暗色主题
- Tailwind 通过 `bg-background` 使用 CSS 变量 `--background`
- 切换 `dark` class → CSS 变量变化 → 全站颜色自动变
- 字体大小用 `data-font-size` 属性控制 `html` 的 `font-size`
- 不需要写两套 CSS，只定义变量值就行

---

## 17. 组件组合——Diff 7 层组件树

### 目标
展示大型功能如何拆分为多层组件。

### 组件树

```
DiffViewer.vue          ← 容器：输入区 + 结果区 + AI 解释区
├── DiffStats.vue       ← 统计：+3 / -2
├── DiffViewToggle.vue  ← 切换：unified / split 视图
├── DiffHunk.vue        ← 每个差异块
│   ├── DiffLine.vue    ← unified 视图的每行
│   │   └── DiffLineContent.vue  ← 行内容（含词级差异高亮）
│   └── (split 视图直接使用 DiffLineContent.vue)
└── DiffExplanation.vue ← AI 对 diff 的解释
```

### 代码示例

```vue
<!-- DiffViewer.vue — 容器 -->
<DiffHunk
  v-for="hunk in diffFile.hunks"
  :key="hunk.id"
  :hunk="hunk"
  :view-mode="viewMode"
  :expanded="expandedHunks.has(hunk.id)"
  @toggle="store.toggleHunk(hunk.id)"
/>
```

```vue
<!-- DiffHunk.vue — 每个差异块 -->
<div v-if="expanded && viewMode === 'unified'">
  <DiffLine v-for="line in hunk.lines" :key="line.id" :line="line" />
</div>

<div v-if="expanded && viewMode === 'split'">
  <div v-for="(pair, idx) in pairedLines" :key="idx" class="flex">
    <DiffLineContent v-if="pair.left" :line="pair.left" />
    <DiffLineContent v-if="pair.right" :line="pair.right" />
  </div>
</div>
```

```vue
<!-- DiffLine.vue — 简单代理组件（只有 10 行） -->
<script setup>
defineProps<{ line: DiffLineType }>()
</script>
<template>
  <DiffLineContent :line="line" />
</template>
```

### 讲解

**拆分原则：**
| 层 | 职责 | 为什么不合并 |
|---|---|---|
| DiffViewer | 输入区域、按钮、整体布局 | 保持页面级组件的简洁 |
| DiffHunk | 单个 hunk 展开/折叠 + 视图切换 | 每个 hunk 是独立的数据单元 |
| DiffLine | unified 视图的包装 | 让 hunk 模板保持干净 |
| DiffLineContent | 渲染行内容、行号、颜色、词级 diff | 核心渲染逻辑，复用率高 |

`DiffLine` 只有 10 行，看起来很"多余"，但它的作用是：如果以后 unified 视图要加特殊样式或交互（比如点击行），只需要改 `DiffLine` 一个文件，不影响 split 视图的 `DiffLineContent`。

---

## 总结速记卡

| 模式 | 一句话记住 |
|---|---|
| **Pinia** | `defineStore('id', () => { ref/computed/function })`, 组件里用 `storeToRefs` 解构 |
| **Props** | `defineProps<{ name: type }>()`, `withDefaults()` 给默认值 |
| **Emit** | `defineEmits<{ event: [payloadType] }>()` |
| **Slot** | `<slot />` 占位, 父级写内容 |
| **Composable** | `useXxx()` 函数, 内部管理 ref/lifecycle, 组件按需调用 |
| **SSE** | 后端 `res.write('data: ...')`, 前端 `ReadableStream.getReader()` + `AsyncGenerator` |
| **Worker** | `postMessage` 发, `onmessage` 收, Promise Map 管理异步 |
| **localStorage** | 存最近 20 条, 同步读写, 页面恢复首选 |
| **IndexedDB** | `idb` 库包装, 异步备份, `fire-and-forget` |
| **AsyncGenerator** | `async function*` + `yield`, 消费方 `for await...of` |
| **Zod** | `z.object({...}).safeParse(data)` 校验 AI 输出 |
| **Teleport** | `<Teleport to="body">` 让浮层突破父组件限制 |
| **CSS变量** | `:root` 定义亮色, `.dark` 覆盖, Tailwind 消费 `var(--xxx)` |
| **LRU 缓存** | `Map` 读写 + 超容量删除最早记录的 key |
