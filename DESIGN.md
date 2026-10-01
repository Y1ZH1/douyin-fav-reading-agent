# AI Code Learning Workbench Pro — 架构升级设计方案

---

# 一、代码Diff对比系统

## 1.1 Diff算法方案

```
npm依赖:
  diff@^7.0.0          — 文本diff核心 (Myers算法)
  @git-diff-calc/core   — GitHub风格的hunk切分逻辑 (备用)
```

**核心选型: `diff` (kpdecker)**

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| `diff` | 成熟稳定、Tree-shakable、支持lines/words/chars三级粒度 | 需自行构建hunk分组 | **选用** |
| `@git-diff-calc/core` | GitHub同款hunk算法 | 体积大、API复杂 | 备用 |
| 自研Myers | 完全可控 | 造轮子、边界情况多 | 不推荐 |

**分层diff策略:**
```
第1层: diffLines()     → 行级diff (主视图)
第2层: diffWords()     → 词级diff (行内高亮)
第3层: diffChars()     → 字符级diff (精确到变量名内的变化)
```

**Diff数据结构设计:**

```typescript
// types/diff.ts

interface DiffHunk {
  id: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

interface DiffLine {
  type: 'add' | 'delete' | 'context' | 'header'
  oldLineNumber?: number
  newLineNumber?: number
  content: string
  wordChanges?: WordChange[]  // 行内词级变更
}

interface WordChange {
  type: 'add' | 'delete' | 'equal'
  text: string
}

interface DiffFile {
  id: string
  oldPath: string
  newPath: string
  language: string
  hunks: DiffHunk[]
  stats: DiffStats
  explanation?: AIExplanation  // AI解释
}

interface DiffStats {
  additions: number
  deletions: number
  filesChanged: number
}

interface AIExplanation {
  summary: string                    // 一句话总结
  sections: AIExplanationSection[]   // 分段解释
}

interface AIExplanationSection {
  hunkId: string
  title: string                      // 如: "提取公共逻辑"
  detail: string                     // 详细解释
  severity: 'info' | 'warning' | 'critical'
}
```

## 1.2 前端渲染方案

**双视图模式:**

```
┌──────────────────────────────────────────────┐
│  [Unified] [Split]   +12 -5  ▲ stats bar    │
├──────────────────────────────────────────────┤
│  12 │ const x = 1          │ context         │
│  13 │                       │                 │
│   - │ const y = oldValue   │ - deleted (red) │
│   + │ const y = newValue   │ + added (green) │
│  14 │ console.log(y)       │ context         │
├──────────────────────────────────────────────┤
│  💡 AI: 将 oldValue 改为 newValue，因为...   │ ← AI解释栏
└──────────────────────────────────────────────┘
```

**渲染方案:**

- 使用CSS Grid布局，避免`<table>`的SEO/可访问性问题
- 行号列 + 操作符列 + 代码列 = 3列Grid
- Split视图 = 左右两个独立的VirtualScroll容器，共享滚动位置
- Unified视图 = 单个虚拟滚动容器

**GitHub风格UI:**
- 新增行: `bg-green-900/20` 底色 + `bg-green-800/40` 行号背景
- 删除行: `bg-red-900/20` 底色 + `bg-red-800/40` 行号背景
- 行内变更: 浅色底色 + 加粗文字
- 悬停行: `bg-gray-800/30` 过渡高亮
- 折叠未变更区域: `... 15 unchanged lines ▼`

## 1.3 Vue组件设计

```
components/
  diff/
    DiffViewer.vue           — 主容器: 视图切换、文件列表、统计
    DiffFile.vue             — 单文件diff: 渲染hunk列表
    DiffHunk.vue             — 单个hunk: 上下文行 + 变更行
    DiffLine.vue             — 单行: 行号 + 操作符 + 内容
    DiffLineContent.vue      — 行内容: Shiki高亮 + 词级变更标记
    DiffStats.vue            — 统计栏: +/- 计数、文件数
    DiffExplanation.vue      — AI解释面板: 折叠/展开、逐段解释
    DiffViewToggle.vue       — Unified/Split切换按钮组
```

**核心组件实现:**

```vue
<!-- DiffViewer.vue — 主容器 -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { diffLines, diffWords } from 'diff'
import type { DiffFile, DiffLine, WordChange } from '@/types/diff'

const props = defineProps<{
  oldCode: string
  newCode: string
  language: string
  explanation?: AIExplanation
}>()

const viewMode = ref<'unified' | 'split'>('unified')

const hunks = computed(() => buildHunks(props.oldCode, props.newCode))
</script>
```

## 1.4 AI Prompt设计

```
System Prompt (diff explanation):

你是一位资深代码审查专家。当用户提供代码diff时，你需要:
1. 逐段分析每个hunk的变更意图
2. 判断变更类型: 重构/修复/优化/功能新增/删除
3. 评估变更的风险等级: info/warning/critical
4. 给出学习要点: 这次变更涉及哪些编程概念

输出格式 (严格JSON):
{
  "summary": "一句话概括整体变更",
  "sections": [
    {
      "hunkId": "hunk-0",
      "title": "提取公共验证逻辑",
      "detail": "将重复的表单验证逻辑提取到validateForm函数中...",
      "severity": "info",
      "learningPoints": ["DRY原则", "单一职责", "函数提取重构"]
    }
  ]
}
```

**交互流程:**
1. 用户粘贴两端代码 (或AI生成前后对比)
2. 前端调用 `buildDiff(oldCode, newCode)` 生成diff数据
3. 同时发起AI请求: `POST /api/diff/explain` 携带diff数据
4. 渲染diff视图 + 逐段渲染AI解释
5. AI解释以tooltip/侧边栏形式展示，支持展开/折叠

---

# 二、AI代码流程图可视化

## 2.1 JSON Schema设计

```typescript
// types/flowchart.ts

interface FlowchartData {
  meta: FlowchartMeta
  nodes: FlowNode[]
  edges: FlowEdge[]
}

interface FlowchartMeta {
  title: string
  description: string
  language: string
  entryNodeId: string
  complexity: 'low' | 'medium' | 'high'
  steps: ExecutionStep[]    // AI解析出的执行步骤 (用于分步动画)
}

/** 节点类型 — 对应VueFlow自定义节点组件 */
type FlowNodeType =
  | 'start'        // 开始 (圆角矩形，绿色边框)
  | 'end'          // 结束 (圆角矩形，红色边框)
  | 'process'      // 处理步骤 (矩形)
  | 'decision'     // 条件判断 (菱形)
  | 'loop'         // 循环体 (六边形)
  | 'function'     // 函数调用 (圆角矩形，蓝色边框)
  | 'io'           // 输入/输出 (平行四边形)
  | 'error'        // 错误处理 (红色虚线)
  | 'code'         // 代码片段节点 (可展开显示原始代码)
  | 'group'        // 逻辑分组 (虚线框，包裹子节点)

interface FlowNode {
  id: string
  type: FlowNodeType
  position: { x: number; y: number }
  data: FlowNodeData
}

interface FlowNodeData {
  label: string
  code?: string            // 关联的代码片段
  description?: string     // 节点描述 (tooltip)
  complexity?: string      // O(n) 等复杂度标注
  groupId?: string         // 所属逻辑分组
  isActive?: boolean       // 用于执行动画: 当前激活节点
  isCompleted?: boolean    // 已执行完成
}

interface FlowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string    // 多出口节点 (如decision的true/false)
  targetHandle?: string
  type?: 'default' | 'animated' | 'step'
  label?: string           // 边上的文字 (如 "是/否", "遍历每个元素")
  data?: {
    condition?: string     // 条件表达式
    dataFlow?: string      // 数据流描述
  }
}

/** 执行步骤 — 用于分步动画和代码执行追踪 */
interface ExecutionStep {
  step: number
  nodeId: string
  description: string
  variables?: Record<string, string>  // 当前变量状态
  duration?: number                   // 执行耗时(ms)
}
```

## 2.2 VueFlow集成方案

```
npm依赖:
  @vue-flow/core@^1.36
  @vue-flow/background@^1.3
  @vue-flow/controls@^1.1
  @vue-flow/minimap@^1.5
  dagre@^0.8.5         — 自动布局算法
  @types/dagre@^0.7
```

**集成架构:**

```
┌─────────────────────────────────────────────────┐
│  FlowchartView.vue       ← 顶层容器              │
│  ┌─────────────────────────────────────────────┐ │
│  │  VueFlow (.vue-flow)                        │ │
│  │  ├── Background    (网格背景)                │ │
│  │  ├── Controls       (缩放/居/锁定)          │ │
│  │  ├── MiniMap        (小地图导航)            │ │
│  │  └── Custom Nodes:                          │ │
│  │      ├── StartNode.vue                      │ │
│  │      ├── EndNode.vue                        │ │
│  │      ├── ProcessNode.vue                    │ │
│  │      ├── DecisionNode.vue                   │ │
│  │      ├── LoopNode.vue                       │ │
│  │      ├── FunctionNode.vue                   │ │
│  │      ├── IONode.vue                         │ │
│  │      ├── ErrorNode.vue                      │ │
│  │      ├── CodeNode.vue     ← 可展开代码片段   │ │
│  │      └── GroupNode.vue    ← 逻辑分组容器     │ │
│  └─────────────────────────────────────────────┘ │
│  StepPlayer.vue  ← 分步执行播放器 (底部栏)      │
└─────────────────────────────────────────────────┘
```

**自动布局 (dagre):**

```typescript
// composables/useFlowLayout.ts
import dagre from 'dagre'

export function useFlowLayout() {
  function autoLayout(data: FlowchartData): FlowchartData {
    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 100 })

    data.nodes.forEach(n => {
      g.setNode(n.id, { width: 200, height: 80 })
    })
    data.edges.forEach(e => {
      g.setEdge(e.source, e.target)
    })

    dagre.layout(g)

    data.nodes.forEach(n => {
      const node = g.node(n.id)
      n.position = { x: node.x - 100, y: node.y - 40 }
    })

    return data
  }

  return { autoLayout }
}
```

## 2.3 节点组件设计

**自定义节点注册:**

```typescript
// components/flow/nodes/index.ts
import type { DefineNodeComponent } from '@vue-flow/core'
import StartNode from './StartNode.vue'
import EndNode from './EndNode.vue'
import ProcessNode from './ProcessNode.vue'
import DecisionNode from './DecisionNode.vue'
// ... 其他节点

export const nodeTypes = {
  start: markRaw(StartNode),
  end: markRaw(EndNode),
  process: markRaw(ProcessNode),
  decision: markRaw(DecisionNode),
  loop: markRaw(LoopNode),
  function: markRaw(FunctionNode),
  io: markRaw(IONode),
  error: markRaw(ErrorNode),
  code: markRaw(CodeNode),
  group: markRaw(GroupNode),
}
```

**节点Template模式 (以DecisionNode为例):**

```vue
<!-- components/flow/nodes/DecisionNode.vue -->
<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { computed } from 'vue'

const props = defineProps<{ data: FlowNodeData }>()

const diamondStyle = computed(() => ({
  // 菱形: 旋转45deg的正方形
  width: '80px',
  height: '80px',
  transform: 'rotate(45deg)',
  // 内部文字反向旋转保持水平
}))
</script>

<template>
  <div class="decision-node-wrapper">
    <Handle type="target" :position="Position.Top" />
    <div class="diamond" :style="diamondStyle">
      <span class="diamond-label">{{ data.label }}</span>
    </div>
    <Handle id="true" type="source" :position="Position.Right" class="handle-true" />
    <Handle id="false" type="source" :position="Position.Bottom" class="handle-false" />
  </div>
</template>
```

## 2.4 状态同步方案

**执行动画状态机:**

```typescript
// stores/flowchart.ts
interface FlowchartState {
  data: FlowchartData | null
  currentStep: number           // 当前执行步骤
  isPlaying: boolean            // 是否播放中
  playbackSpeed: number         // 播放速度 (ms/step)
  highlightedNodeId: string | null
  nodeStates: Map<string, 'idle' | 'active' | 'completed' | 'error'>
}

// 分步播放器: 类似调试器的 Step Into / Step Over / Continue
// 每步: 高亮节点 → 展示变量 → 等待 → 移动到下一步
```

**与AI的交互:**
1. 用户输入代码 → `POST /api/flowchart/generate` → AI返回FlowchartData JSON
2. 前端用Zod校验JSON → dagre自动布局 → VueFlow渲染
3. 用户可手动拖动节点调整布局
4. 点击节点 → 展开关联代码 / AI解释
5. 底部StepPlayer → 逐步播放执行过程

---

# 三、AI结构化输出系统

## 3.1 总体架构

```
┌──────────────────────────────────────────────────┐
│                  AI Response Pipeline             │
│                                                   │
│  Raw SSE Stream                                   │
│       │                                           │
│       ▼                                           │
│  ResponseClassifier  ←── 分类: "这是什么类型的响应?" │
│       │                                           │
│       ├── text/markdown  → MarkdownRenderer       │
│       ├── application/json → JSONValidator        │
│       ├── flowchart     → FlowchartViewer          │
│       ├── diff          → DiffViewer               │
│       └── mixed         → MixedContentParser       │
│                                 │                 │
│                                 ▼                 │
│                          StructuredRenderer       │
│                          (根据类型选择渲染器)      │
└──────────────────────────────────────────────────┘
```

## 3.2 TypeScript类型设计 (核心)

```typescript
// types/ai-response.ts
import { z } from 'zod'

// ========== 响应类型鉴别 ==========

type AIResponseType =
  | 'text/markdown'
  | 'application/json'
  | 'application/flowchart'
  | 'application/diff'
  | 'application/explanation'
  | 'multipart/mixed'

// ========== 基础响应 ==========

interface AIResponseBase {
  id: string
  type: AIResponseType
  timestamp: number
}

// ========== 各类型响应 ==========

interface MarkdownResponse extends AIResponseBase {
  type: 'text/markdown'
  content: string
}

interface JSONResponse<T = unknown> extends AIResponseBase {
  type: 'application/json'
  content: T
  raw: string
}

interface FlowchartResponse extends AIResponseBase {
  type: 'application/flowchart'
  content: FlowchartData      // 引用上面定义的FlowchartData
}

interface DiffResponse extends AIResponseBase {
  type: 'application/diff'
  content: DiffFile[]          // 引用上面定义的DiffFile
}

interface ExplanationResponse extends AIResponseBase {
  type: 'application/explanation'
  content: AIExplanation
}

interface MixedContentResponse extends AIResponseBase {
  type: 'multipart/mixed'
  parts: MixedPart[]
}

type MixedPart =
  | { type: 'text/markdown'; content: string }
  | { type: 'application/json'; content: unknown }
  | { type: 'application/flowchart'; content: FlowchartData }

// ========== 判别联合 ==========

type AIResponse =
  | MarkdownResponse
  | JSONResponse
  | FlowchartResponse
  | DiffResponse
  | ExplanationResponse
  | MixedContentResponse

// ========== 流式解析状态机 ==========

type ParseState =
  | { phase: 'idle' }
  | { phase: 'text'; buffer: string }
  | { phase: 'json_block_start'; depth: number; buffer: string }
  | { phase: 'json_block'; buffer: string; depth: number }
  | { phase: 'code_fence'; language: string; buffer: string }
  | { phase: 'done'; response: AIResponse }
```

## 3.3 JSON校验层 (Zod Schema)

```typescript
// schemas/ai-response.schema.ts
import { z } from 'zod'

// Flowchart Schema — 与上面2.1节的类型严格对应
const FlowNodeDataSchema = z.object({
  label: z.string().min(1),
  code: z.string().optional(),
  description: z.string().optional(),
  complexity: z.string().optional(),
  isActive: z.boolean().optional(),
  isCompleted: z.boolean().optional(),
})

const FlowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['start', 'end', 'process', 'decision', 'loop', 'function', 'io', 'error', 'code', 'group']),
  position: z.object({ x: z.number(), y: z.number() }),
  data: FlowNodeDataSchema,
})

const FlowchartDataSchema = z.object({
  meta: z.object({
    title: z.string(),
    description: z.string(),
    language: z.string(),
    entryNodeId: z.string(),
    complexity: z.enum(['low', 'medium', 'high']),
    steps: z.array(z.object({
      step: z.number(),
      nodeId: z.string(),
      description: z.string(),
      variables: z.record(z.string()).optional(),
      duration: z.number().optional(),
    })),
  }),
  nodes: z.array(FlowNodeSchema).min(1),
  edges: z.array(z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    label: z.string().optional(),
    data: z.object({
      condition: z.string().optional(),
      dataFlow: z.string().optional(),
    }).optional(),
  })),
})

// Diff Schema
const AIExplanationSchema = z.object({
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

## 3.4 AI响应解析层

```typescript
// services/ai/response-parser.ts

/**
 * 流式解析AI输出 — 边接收边分类
 * 核心思路: 检测SSE流中的特殊标记来决定内容类型
 *
 * 标记约定 (与System Prompt配合):
 *   <!--TYPE:flowchart--> → 后续JSON是流程图数据
 *   <!--TYPE:diff-->      → 后续内容是diff
 *   <!--TYPE:json-->      → 后续内容是JSON
 *   无标记                → 默认markdown
 */
export class AIResponseParser {
  private buffer = ''
  private state: ParseState = { phase: 'idle' }

  /** 每次收到一个chunk, 推进解析状态机 */
  feed(chunk: string): ParseResult[] {
    this.buffer += chunk
    const results: ParseResult[] = []

    switch (this.state.phase) {
      case 'idle':
        if (this.buffer.includes('<!--TYPE:flowchart-->')) {
          this.state = { phase: 'json_block', buffer: '', depth: 0 }
          this.buffer = this.buffer.split('<!--TYPE:flowchart-->')[1]
        }
        break

      case 'json_block':
        // 追踪花括号深度
        for (const char of chunk) {
          if (char === '{') this.state.depth++
          if (char === '}') this.state.depth--
          this.state.buffer += char
          if (this.state.depth === 0 && this.state.buffer.includes('{')) {
            // JSON块闭合 → 尝试解析
            results.push({ type: 'json_complete', raw: this.state.buffer })
            this.state = { phase: 'done', response: /* parse result */ /* TODO */ }
          }
        }
        break
    }

    return results
  }
}

type ParseResult =
  | { type: 'text_chunk'; content: string }
  | { type: 'json_complete'; raw: string }
  | { type: 'error'; message: string }
```

## 3.5 错误恢复机制

```typescript
// services/ai/error-recovery.ts

interface ErrorRecoveryStrategy {
  /** 当JSON解析失败时尝试修复 */
  repair(rawJson: string): string
  /** 当Schema校验失败时尝试降级 */
  degrade(invalidData: unknown, schema: z.ZodType, errors: z.ZodError): unknown
}

export class AIErrorRecovery implements ErrorRecoveryStrategy {
  repair(raw: string): string {
    let fixed = raw

    // 1. 修复尾部截断的JSON: 补全缺失的 } ] "
    fixed = this.closeUnterminated(fixed)

    // 2. 移除尾部不完整的属性 (流式中断导致)
    fixed = this.trimIncompleteTrailingProperty(fixed)

    // 3. 修复常见的JSON语法错误
    fixed = fixed
      .replace(/,\s*}/g, '}')       // 尾部多余逗号
      .replace(/,\s*\]/g, ']')       // 数组尾部多余逗号
      .replace(/\n/g, '\\n')         // 未转义换行符 (在字符串值中)

    return fixed
  }

  degrade(invalid: unknown, schema: z.ZodType, errors: z.ZodError): unknown {
    // 降级策略: 保留有效字段，丢弃无效字段
    // 对于流程图: 至少保留有效节点
    // 对于diff: 至少保留能解析的文本
    if (typeof invalid === 'object' && invalid !== null) {
      const obj = invalid as Record<string, unknown>
      // 尝试只提取 schema 中定义的字段
      // ...
    }
    return invalid
  }

  private closeUnterminated(json: string): string {
    let depth = 0
    for (const ch of json) {
      if (ch === '{' || ch === '[') depth++
      if (ch === '}' || ch === ']') depth--
    }
    while (depth > 0) {
      json += (json.trimEnd().endsWith('[') || json.trimEnd().endsWith('{')) ? '' : '}'
      depth--
    }
    return json
  }

  private trimIncompleteTrailingProperty(json: string): string {
    const lastComma = json.lastIndexOf(',"')
    if (lastComma > json.lastIndexOf('}')) {
      return json.substring(0, lastComma) + '}'
    }
    return json
  }
}
```

---

# 四、升级版Hover解释系统

## 4.1 Composable设计

```typescript
// composables/useSmartHover.ts
import { ref, shallowRef } from 'vue'
import { useDebounceFn } from '@vueuse/core'

interface HoverState {
  target: HTMLElement | null
  keyword: string
  context: string         // 选中关键词的上下文代码 (前后各3行)
  position: { x: number; y: number }
  status: 'idle' | 'loading' | 'streaming' | 'done' | 'error'
  content: string
  controller: AbortController | null
}

export function useSmartHover() {
  const state = ref<HoverState>({ /* defaults */ })
  const cache = new Map<string, { content: string; timestamp: number }>()
  const CACHE_TTL = 5 * 60 * 1000  // 5分钟

  // 防抖: 300ms后发起请求
  const debouncedFetch = useDebounceFn(async (keyword: string, context: string) => {
    // 1. 检查缓存
    const cacheKey = `${keyword}:${hashContext(context)}`
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      state.value.content = cached.content
      state.value.status = 'done'
      return
    }

    // 2. 取消上一次请求
    state.value.controller?.abort()
    const controller = new AbortController()
    state.value.controller = controller
    state.value.status = 'loading'

    try {
      // 3. 流式请求
      for await (const chunk of streamExplanation(keyword, context, controller.signal)) {
        state.value.content += chunk.content
        state.value.status = 'streaming'
      }
      state.value.status = 'done'
      cache.set(cacheKey, { content: state.value.content, timestamp: Date.now() })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      state.value.status = 'error'
    }
  }, 300)

  function onHoverStart(el: HTMLElement, keyword: string, context: string, pos: { x: number; y: number }) {
    state.value = { target: el, keyword, context, position: pos, status: 'idle', content: '', controller: null }
    debouncedFetch(keyword, context)
  }

  function onHoverEnd() {
    state.value.controller?.abort()
    state.value.status = 'idle'
  }

  return { state, onHoverStart, onHoverEnd }
}
```

## 4.2 Tooltip状态管理

```typescript
// stores/hover.ts — 集中管理hover状态, 支持全局tooltip单例
import { defineStore } from 'pinia'

export const useHoverStore = defineStore('hover', () => {
  const isVisible = ref(false)
  const position = ref({ x: 0, y: 0 })
  const content = ref('')
  const isLoading = ref(false)
  const activeKeyword = ref('')

  // 智能定位: 确保tooltip不超出视口
  const adjustedPosition = computed(() => {
    const PADDING = 16
    let { x, y } = position.value
    // 假设tooltip宽300px, 高自适应
    if (x + 320 > window.innerWidth) x = window.innerWidth - 320 - PADDING
    if (y + 200 > window.innerHeight) y = y - 200 - PADDING
    return { x, y }
  })

  function show(pos: { x: number; y: number }, keyword: string) {
    position.value = pos
    activeKeyword.value = keyword
    isVisible.value = true
    isLoading.value = true
  }

  function updateContent(text: string) {
    content.value = text
    isLoading.value = false
  }

  function hide() {
    isVisible.value = false
    content.value = ''
  }

  return { isVisible, position: adjustedPosition, content, isLoading, activeKeyword, show, updateContent, hide }
})
```

## 4.3 请求优化方案

```
三层缓存策略:

L1: 内存缓存 (Map)
  - TTL: 5分钟
  - 命中条件: keyword + 上下文哈希完全相同
  - 生命周期: 页面内

L2: SessionStorage缓存
  - TTL: 当前标签页会话
  - 命中条件: keyword + 语言相同
  - 容量限制: 最多50条

L3: 无缓存 → 发起AI请求
  - AbortController取消机制
  - 300ms防抖
  - 请求超时: 10s
  - 失败降级: 显示静态关键词库内容 (keywords.ts)
```

---

# 五、聊天系统升级

## 5.1 Store架构升级

```typescript
// stores/chat.ts — 升级版

import { defineStore } from 'pinia'
import { openDB, type IDBPDatabase } from 'idb'

// ========== 消息状态机 ==========

type MessageStatus =
  | 'pending'       // 待发送 (队列中)
  | 'sending'       // 发送中
  | 'streaming'     // AI回复流式传输中
  | 'done'          // 完成
  | 'error'         // 出错
  | 'aborted'       // 用户手动停止
  | 'regenerating'  // 重新生成中
  | 'edited'        // 用户编辑过消息

type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

// 状态转换规则
const MESSAGE_TRANSITIONS: Record<MessageStatus, MessageStatus[]> = {
  pending:       ['sending', 'error'],
  sending:       ['streaming', 'done', 'error', 'aborted'],
  streaming:     ['done', 'error', 'aborted'],
  done:          ['regenerating', 'edited'],
  error:         ['sending'],          // 可重试
  aborted:       ['sending'],          // 可重试
  regenerating:  ['streaming', 'error', 'aborted'],
  edited:        ['sending'],
}

// ========== ChatMessage 升级 ==========

interface ChatMessage {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  status: MessageStatus
  timestamp: number
  tokenCount?: number            // token计数
  metadata?: MessageMetadata     // 元数据
  parentId?: string              // 指向被编辑/重生成的原始消息
  childrenIds?: string[]         // 分支消息ID (regenerate产生新分支)
}

interface MessageMetadata {
  model: string
  temperature: number
  responseType?: AIResponseType  // 响应内容类型
  latencyMs?: number             // 首token延迟
  totalLatencyMs?: number        // 总耗时
  structuredData?: unknown       // 结构化输出 (JSON/Flowchart等)
}

// ========== ChatSession 升级 ==========

interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  pinned: boolean
  tags: string[]
  model: string
  systemPrompt?: string         // 自定义System Prompt
  messageTree: string[]          // 树形消息结构 (支持分支)
}
```

```typescript
// stores/chat.ts — Store实现

export const useChatStore = defineStore('chat-pro', () => {
  // --- Core State ---
  const sessions = ref<ChatSession[]>([])
  const messages = ref<Map<string, ChatMessage>>(new Map())  // 用Map，O(1)查找
  const activeSessionId = ref<string | null>(null)
  const isGenerating = ref(false)
  const abortController = ref<AbortController | null>(null)
  const db = ref<IDBPDatabase | null>(null)

  // --- IndexedDB ---
  async function initDB() {
    db.value = await openDB('ai-code-tutor', 3, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('sessions', { keyPath: 'id' })
          db.createObjectStore('messages', { keyPath: 'id' })
        }
        if (oldVersion < 2) {
          const msgStore = db.transaction('messages').objectStore('messages')
          msgStore.createIndex('sessionId', 'sessionId')
        }
        if (oldVersion < 3) {
          const sessionStore = db.transaction('sessions').objectStore('sessions')
          sessionStore.createIndex('updatedAt', 'updatedAt')
        }
      },
    })
    await loadFromDB()
  }

  async function persistSession(session: ChatSession) {
    await db.value?.put('sessions', session)
  }

  async function persistMessage(msg: ChatMessage) {
    await db.value?.put('messages', msg)
  }

  // --- 消息分支 (用于Regenerate) ---
  function regenerateMessage(messageId: string) {
    const msg = messages.value.get(messageId)
    if (!msg || msg.role !== 'assistant') return

    // 创建子分支
    const childId = generateId()
    msg.childrenIds = [...(msg.childrenIds || []), childId]

    // 创建新的assistant消息 (regenerating状态)
    const newMsg: ChatMessage = {
      id: childId,
      sessionId: msg.sessionId,
      role: 'assistant',
      content: '',
      status: 'regenerating',
      timestamp: Date.now(),
      parentId: messageId,
    }

    messages.value.set(childId, newMsg)
    persistMessage(newMsg)

    // 重新发送请求
    streamResponse(childId, msg.parentId!)  // 使用同一个user消息
  }

  // --- 中断恢复 ---
  async function recoverInterrupted() {
    // 启动时检查是否有 'streaming' | 'sending' 状态的消息
    for (const msg of messages.value.values()) {
      if (msg.status === 'streaming' || msg.status === 'sending') {
        msg.status = 'error'  // 标记为错误, 允许用户重试
        await persistMessage(msg)
      }
    }
  }

  return {
    sessions, messages, activeSessionId, isGenerating, abortController,
    initDB, persistSession, persistMessage,
    regenerateMessage, recoverInterrupted,
    // ... 其他actions
  }
})
```

## 5.2 IndexedDB方案

```
npm依赖:
  idb@^8.0.0          — IndexedDB Promise封装 (轻量、tree-shakable)

数据库设计:

Database: ai-code-tutor-pro
Version: 3

ObjectStores:
  sessions          keyPath: id
    indexes: updatedAt (用于排序)

  messages          keyPath: id
    indexes: sessionId (用于按会话查询)

  assets            keyPath: id       — 可选: 缓存代码片段等
    indexes: sessionId

存储策略:
  - 自动清理: 保留最近50个会话, 30天前的非置顶会话自动删除
  - 消息上限: 每个会话最多500条消息
  - 写入策略: debounce(500ms) 批量写入
```

---

# 六、Markdown系统升级

## 6.1 markdown-it插件方案

```
npm依赖:
  markdown-it@^14.1.0         — 已有
  markdown-it-container@^4.0  — 自定义容器 (代码折叠/diff块)
  markdown-it-katex@^2.0      — LaTeX数学公式 (KaTeX渲染)
  markdown-it-mermaid@^0.2     — Mermaid图 (服务端渲染为SVG)
  markdown-it-attrs@^4.2      — 属性注入: {.class #id}
  markdown-it-anchor@^8.6     — 标题锚点
  markdown-it-toc-done-right@^4.2 — 目录生成
  katex@^0.16                 — LaTeX渲染引擎
  mermaid@^11                 — 图表渲染
```

**插件注册顺序 (至关重要):**

```typescript
// composables/useMarkdown.ts — 升级版

import MarkdownIt from 'markdown-it'
import container from 'markdown-it-container'
import katex from 'markdown-it-katex'
import attrs from 'markdown-it-attrs'
import anchor from 'markdown-it-anchor'
import { createHighlighter } from 'shiki'

let md: MarkdownIt | null = null

export function createMarkdownRenderer(): MarkdownIt {
  if (md) return md

  md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: true,
  })

  // 1. KaTeX (数学公式)
  md.use(katex, { throwOnError: false, errorColor: '#ff6b6b' })

  // 2. 自定义容器 — Diff块
  md.use(container, 'diff', {
    validate: name => name === 'diff',
    render: (tokens, idx) => {
      if (tokens[idx].nesting === 1) {
        return '<DiffBlock>\n'
      }
      return '</DiffBlock>\n'
    },
  })

  // 3. 自定义容器 — 代码折叠
  md.use(container, 'details', {
    validate: name => name === 'details',
    render: (tokens, idx) => {
      if (tokens[idx].nesting === 1) {
        const summary = tokens[idx].info.trim() || 'Details'
        return `<details class="code-details"><summary>${summary}</summary>\n`
      }
      return '</details>\n'
    },
  })

  // 4. 属性注入 — 支持 {.focus} 聚焦高亮
  md.use(attrs)

  // 5. Mermaid — 自定义fence规则
  const defaultFence = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    if (token.info.trim() === 'mermaid') {
      return `<MermaidDiagram code="${encodeURIComponent(token.content)}" />`
    }
    // 语言后缀 .focus → 聚焦高亮
    if (token.info.endsWith('.focus')) {
      const lang = token.info.replace('.focus', '')
      return `<CodeBlock language="${lang}" focus="true">${token.content}</CodeBlock>`
    }
    return defaultFence(tokens, idx, options, env, self)
  }

  // 6. 锚点
  md.use(anchor, { permalink: anchor.permalink.linkInsideHeader({
    symbol: '#',
    renderAttrs: () => ({ 'class': 'heading-anchor' }),
  })})

  return md
}
```

## 6.2 新增Vue组件

```vue
<!-- components/markdown/MermaidDiagram.vue -->
<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import mermaid from 'mermaid'

mermaid.initialize({ theme: 'dark', startOnLoad: false })

const props = defineProps<{ code: string }>()
const container = ref<HTMLDivElement>()

async function render() {
  if (!container.value) return
  const { svg } = await mermaid.render('mermaid-' + Date.now(), props.code)
  container.value.innerHTML = svg
}

onMounted(render)
watch(() => props.code, render)
</script>

<template>
  <div ref="container" class="mermaid-container" />
</template>
```

```vue
<!-- components/markdown/KatexInline.vue -->
<script setup lang="ts">
import katex from 'katex'
import { computed } from 'vue'

const props = defineProps<{ formula: string; displayMode?: boolean }>()
const html = computed(() => katex.renderToString(props.formula, {
  throwOnError: false,
  displayMode: props.displayMode ?? false,
}))
</script>

<template>
  <span v-if="!displayMode" v-html="html" class="inline-katex" />
  <div v-else v-html="html" class="block-katex" />
</template>
```

---

# 七、性能优化升级

## 7.1 性能瓶颈分析

```
当前瓶颈 (按严重性排序):

🔴 Critical:
  1. 长聊天历史无虚拟滚动 → 100+消息时DOM节点过多, 卡顿严重
  2. Shiki每次渲染创建新实例 → 重复初始化wasm, 内存泄漏风险

🟡 High:
  3. 大markdown内容在主线程解析 → 阻塞UI (200ms+ 对于大型响应)
  4. SSE流式更新触发全量重渲染 → 每条chunk都触发Vue reactity

🟢 Medium:
  5. VueFlow大图 (100+节点) → 拖拽/缩放卡顿
  6. 无代码分割 → 首屏加载所有组件
  7. 无请求去重 → 重复hover发起相同请求
```

## 7.2 优化策略

### 7.2.1 虚拟滚动 (解决 #1)

```
npm依赖:
  vue-virtual-scroller@^2.0  — Vue3虚拟滚动
  或自行基于 @vueuse/core useVirtualList 封装
```

```vue
<!-- components/chat/ChatArea.vue — 升级 -->
<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual'

const containerRef = ref<HTMLElement>()
const messages = computed(() => chatStore.activeMessages)

const virtualizer = useVirtualizer({
  count: messages.value.length,
  getScrollElement: () => containerRef.value,
  estimateSize: () => 120,    // 预估每条消息高度
  overscan: 5,                // 预渲染5条
})

// 流式更新时动态调整行高 (消息内容在增长)
watchEffect(() => {
  const lastIdx = messages.value.length - 1
  virtualizer.value.measureElement(lastIdx)
})
</script>

<template>
  <div ref="containerRef" class="chat-messages">
    <div :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }">
      <div
        v-for="row in virtualizer.getVirtualItems()"
        :key="row.key"
        :style="{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)` }"
      >
        <ChatMessage :message="messages[row.index]" />
      </div>
    </div>
  </div>
</template>
```

### 7.2.2 Shiki缓存 (解决 #2)

```typescript
// composables/useCodeHighlight.ts — 升级版

import { createHighlighter, type Highlighter } from 'shiki'

class ShikiCache {
  private static instance: ShikiCache
  private highlighter: Highlighter | null = null
  private cache = new LRUCache<string>(200)  // 最多缓存200个结果
  private initPromise: Promise<void> | null = null

  static getInstance() {
    if (!ShikiCache.instance) ShikiCache.instance = new ShikiCache()
    return ShikiCache.instance
  }

  async getHighlighter(): Promise<Highlighter> {
    if (this.highlighter) return this.highlighter
    if (!this.initPromise) {
      this.initPromise = createHighlighter({
        themes: ['github-dark'],
        langs: ['typescript', 'javascript', 'vue', 'python', 'html', 'css', 'json', 'bash', 'markdown', 'yaml', 'jsx', 'tsx', 'sql', 'rust', 'go', 'java'],
      }).then(h => { this.highlighter = h })
    }
    return this.initPromise.then(() => this.highlighter!)
  }

  async highlight(code: string, lang: string): Promise<string> {
    const key = `${lang}:${code.slice(0, 200)}:${code.length}`
    if (this.cache.has(key)) return this.cache.get(key)!

    const h = await this.getHighlighter()
    const result = h.codeToHtml(code, { lang, theme: 'github-dark' })
    this.cache.set(key, result)
    return result
  }
}
```

### 7.2.3 Web Worker解析Markdown (解决 #3)

```typescript
// workers/markdown.worker.ts

import MarkdownIt from 'markdown-it'
// Worker中初始化 (不需要DOM)

const md = new MarkdownIt({ breaks: true, linkify: true })

self.onmessage = (e: MessageEvent<{ id: string; content: string }>) => {
  const { id, content } = e.data
  const html = md.render(content)
  self.postMessage({ id, html })
}
```

```typescript
// composables/useWorkerMarkdown.ts

let worker: Worker | null = null

export function useWorkerMarkdown() {
  const pending = new Map<string, (html: string) => void>()

  function getWorker() {
    if (!worker) {
      worker = new Worker(new URL('../workers/markdown.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e) => {
        const { id, html } = e.data
        pending.get(id)?.(html)
        pending.delete(id)
      }
    }
    return worker
  }

  function renderInWorker(content: string): Promise<string> {
    return new Promise(resolve => {
      const id = generateId()
      pending.set(id, resolve)
      getWorker().postMessage({ id, content })
    })
  }

  return { renderInWorker }
}
```

### 7.2.4 VueFlow性能优化 (解决 #5)

```typescript
// 优化策略:
// 1. 节点>50时禁用动画
// 2. 使用 onlyRenderVisibleElements (只渲染视口内节点)
// 3. 节点拖拽锁定 (只读模式)

<VueFlow
  :nodes="nodes"
  :edges="edges"
  :nodes-draggable="nodes.length < 50"
  :only-render-visible-elements="true"
  :min-zoom="0.2"
  :max-zoom="2"
  fit-view-on-init
>
```

### 7.2.5 整体优化矩阵

| 优化项 | 收益 | 成本 | 优先级 |
|--------|------|------|--------|
| 虚拟滚动 | 极高 (100+消息) | 中 | P0 |
| Shiki单例缓存 | 高 | 低 | P0 |
| Web Worker Markdown | 中-高 | 中 | P1 |
| VueFlow视口渲染 | 高 (大图) | 低 | P1 |
| 路由懒加载 | 中 | 低 | P1 |
| 请求去重/缓存 | 中 | 低 | P2 |
| 图片懒加载 | 低 | 低 | P3 |

---

# 八、前端架构升级

## 8.1 分层架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                        │
│  Views (pages)  │  Layout Components  │  Feature Components │
│  HomeView       │  AppLayout          │  DiffViewer         │
│  ExplainView    │  Sidebar            │  FlowchartViewer    │
│  WorkspaceView  │  CommandPalette     │  SmartHoverTooltip   │
│  SettingsView   │  StatusBar          │  ...                │
├─────────────────────────────────────────────────────────────┤
│                    COMPOSITION LAYER                         │
│  ┌───────────────┬──────────────┬──────────────────────┐   │
│  │ Chat          │ Code         │ Visualization        │   │
│  │ useChat       │ useSmartHover│ useFlowLayout        │   │
│  │ useChatStream │ useMarkdown  │ useExecutionAnim     │   │
│  │ useAutoScroll │ useDiffViewer│ useFlowchartData     │   │
│  │ useMessageBranch│              │                      │   │
│  └───────────────┴──────────────┴──────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                      SERVICE LAYER                           │
│  ┌───────────────┬──────────────┬──────────────────────┐   │
│  │ AI Service    │ Parser       │ Persistence          │   │
│  │ streamChat    │ MarkdownParser│ IndexedDBService    │   │
│  │ streamExplain │ JSONValidator │ SessionStorage     │   │
│  │ streamFlowchart│ AIResponseParser│ CacheService     │   │
│  │               │ DiffParser    │                      │   │
│  └───────────────┴──────────────┴──────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│                       STORE LAYER                            │
│  chatStore  │  settingsStore  │  hoverStore  │  uiStore    │
│  flowchartStore  │  diffStore  │  workspaceStore           │
├─────────────────────────────────────────────────────────────┤
│                        CORE LAYER                            │
│  Types  │  Schemas (Zod)  │  Constants  │  Utils  │  Icons │
└─────────────────────────────────────────────────────────────┘
```

## 8.2 Composables分层

```
composables/
  chat/                          — 聊天相关
    useChat.ts                   — 聊天核心编排 (send/stop/retry/regenerate)
    useChatStream.ts             — SSE流处理逻辑 (从useChat中抽离)
    useMessageBranch.ts          — 消息分支/版本管理
    useSessionPersist.ts         — 会话持久化 (IndexedDB)

  code/                          — 代码相关
    useCodeHighlight.ts          — Shiki高亮 (单例+缓存)
    useMarkdown.ts               — Markdown渲染 (插件链)
    useSmartHover.ts             — 智能hover → AI解释
    useDiffViewer.ts             — Diff状态管理 (视图模式/hunk折叠)
    useDiffRender.ts             — Diff数据构建 (调用diff库)

  visualization/                 — 可视化相关
    useFlowLayout.ts             — dagre自动布局
    useFlowchartData.ts          — Flowchart数据获取/校验
    useExecutionAnimation.ts     — 分步执行动画
    useFlowInteraction.ts        — 节点点击/拖拽交互

  workspace/                     — 工作台相关
    useCommandPalette.ts         — 命令面板 (Ctrl+K)
    useKeyboardShortcuts.ts      — 键盘快捷键注册

  ui/                            — UI通用
    useAutoScroll.ts             — 自动滚动 (已有)
    useVirtualList.ts            — 虚拟滚动封装
    useBreakpoint.ts             — 响应式断点

  core/                          — 核心通用
    useAbortController.ts        — AbortController管理
    useDebouncedFetch.ts         — 带防抖/缓存的fetch封装
    useRequestCache.ts           — 请求缓存 (Map + TTL)
```

## 8.3 Stores拆分

```
stores/
  chat.ts              — 聊天核心: 会话/消息CRUD + 流式状态 + IndexedDB
  settings.ts          — 应用设置: 主题/字体/API配置 (已有)
  hover.ts             — Hover tooltip: 位置/内容/加载状态
  flowchart.ts         — 流程图: 数据/执行步骤/动画状态
  diff.ts              — Diff: 视图模式/hunk展开状态/文件选择
  ui.ts                — UI全局: 侧边栏展开/命令面板/loading
  workspace.ts         — 工作台: 打开的标签页/文件/当前上下文
```

## 8.4 Service层设计

```
services/
  ai/
    client.ts               — AI请求客户端 (fetch封装, 统一错误处理)
    stream-parser.ts         — SSE流解析器 (从现有api/chat.ts抽离)
    prompt-templates.ts      — System Prompt模板管理
    response-classifier.ts   — AI响应类型分类器
    error-recovery.ts        — 错误恢复策略

  parser/
    markdown-parser.ts       — Markdown → HTML (支持Worker)
    json-validator.ts        — Zod Schema校验 + 类型推导
    diff-parser.ts           — 代码 → DiffData
    flowchart-parser.ts      — JSON → VueFlow兼容数据

  persistence/
    idb-service.ts           — IndexedDB CRUD封装
    session-storage.ts       — SessionStorage封装
    cache-service.ts         — 多层缓存管理 (L1/L2/L3)

  visualization/
    flow-layout.ts           — dagre布局算法封装
    flow-renderer.ts         — VueFlow配置管理
```

---

# 九、升级版项目目录结构

```
aicodetutor/
├── DESIGN.md                          # 本设计文档
├── package.json                       # Root monorepo
│
├── client/                            # Vue 3 Frontend
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   │
│   └── src/
│       ├── main.ts                    # 入口: createApp + plugins
│       ├── App.vue                    # 根组件: <RouterView /> + 全局Provider
│       │
│       ├── assets/
│       │   ├── main.css               # Tailwind + 全局CSS变量
│       │   ├── diff.css               # Diff视图专用样式
│       │   ├── flowchart.css          # VueFlow主题覆盖
│       │   └── fonts/                 # 字体文件
│       │
│       ├── types/                     # TypeScript类型定义
│       │   ├── index.ts               # 统一导出
│       │   ├── chat.ts                # ChatMessage, ChatSession, MessageStatus
│       │   ├── code.ts                # CodeBlock, TooltipData
│       │   ├── diff.ts                # DiffFile, DiffHunk, DiffLine, AIExplanation
│       │   ├── flowchart.ts           # FlowchartData, FlowNode, FlowEdge
│       │   ├── ai-response.ts         # AIResponse判别联合 + ParseState
│       │   └── settings.ts            # AppSettings
│       │
│       ├── schemas/                   # Zod校验Schema
│       │   ├── index.ts
│       │   ├── flowchart.schema.ts    # FlowchartData校验
│       │   ├── diff.schema.ts         # AIExplanation校验
│       │   └── ai-response.schema.ts  # 通用AI响应校验
│       │
│       ├── constants/                 # 常量
│       │   ├── index.ts
│       │   ├── languages.ts           # 支持的语言列表
│       │   ├── prompt-templates.ts    # AI Prompt模板
│       │   └── theme.ts              # 主题色/tokens
│       │
│       ├── lib/                       # 工具函数
│       │   ├── utils.ts               # cn(), generateId(), formatTimestamp()
│       │   ├── keywords.ts            # 静态关键词库 (hover降级)
│       │   └── lru-cache.ts           # LRU缓存实现
│       │
│       ├── router/
│       │   └── index.ts               # 路由配置
│       │
│       ├── stores/                    # Pinia Store层
│       │   ├── index.ts
│       │   ├── chat.ts                # 聊天核心Store
│       │   ├── settings.ts            # 设置Store
│       │   ├── hover.ts               # Hover tooltip Store
│       │   ├── flowchart.ts           # 流程图Store
│       │   ├── diff.ts                # Diff Store
│       │   ├── ui.ts                  # UI全局Store
│       │   └── workspace.ts           # 工作台Store
│       │
│       ├── services/                  # 服务层 (非Vue, 纯TS)
│       │   ├── ai/
│       │   │   ├── client.ts          # AI请求客户端
│       │   │   ├── stream-parser.ts   # SSE解析
│       │   │   ├── prompt-templates.ts
│       │   │   ├── response-classifier.ts
│       │   │   └── error-recovery.ts
│       │   │
│       │   ├── parser/
│       │   │   ├── markdown-parser.ts
│       │   │   ├── json-validator.ts
│       │   │   ├── diff-parser.ts
│       │   │   └── flowchart-parser.ts
│       │   │
│       │   ├── persistence/
│       │   │   ├── idb-service.ts     # IndexedDB
│       │   │   ├── session-storage.ts
│       │   │   └── cache-service.ts
│       │   │
│       │   └── visualization/
│       │       ├── flow-layout.ts
│       │       └── flow-renderer.ts
│       │
│       ├── composables/               # Composition层 (有Vue reactivity)
│       │   ├── chat/
│       │   │   ├── useChat.ts
│       │   │   ├── useChatStream.ts
│       │   │   ├── useMessageBranch.ts
│       │   │   └── useSessionPersist.ts
│       │   │
│       │   ├── code/
│       │   │   ├── useCodeHighlight.ts
│       │   │   ├── useMarkdown.ts
│       │   │   ├── useSmartHover.ts
│       │   │   ├── useDiffViewer.ts
│       │   │   └── useDiffRender.ts
│       │   │
│       │   ├── visualization/
│       │   │   ├── useFlowLayout.ts
│       │   │   ├── useFlowchartData.ts
│       │   │   ├── useExecutionAnimation.ts
│       │   │   └── useFlowInteraction.ts
│       │   │
│       │   ├── workspace/
│       │   │   ├── useCommandPalette.ts
│       │   │   └── useKeyboardShortcuts.ts
│       │   │
│       │   ├── ui/
│       │   │   ├── useAutoScroll.ts
│       │   │   ├── useVirtualList.ts
│       │   │   └── useBreakpoint.ts
│       │   │
│       │   └── core/
│       │       ├── useAbortController.ts
│       │       ├── useDebouncedFetch.ts
│       │       └── useRequestCache.ts
│       │
│       ├── views/                     # 页面
│       │   ├── HomeView.vue           # 聊天主页
│       │   ├── ExplainView.vue        # 代码解释页
│       │   ├── DiffView.vue           # Diff对比工作台
│       │   ├── FlowchartView.vue      # 流程图可视化
│       │   └── SettingsView.vue       # 设置页
│       │
│       ├── components/                # 组件
│       │   ├── layout/
│       │   │   ├── AppLayout.vue      # 全局布局 (Sidebar + Main + StatusBar)
│       │   │   ├── Sidebar.vue        # 侧边栏
│       │   │   ├── CommandPalette.vue # 命令面板 (Ctrl+K)
│       │   │   └── StatusBar.vue      # 底部状态栏
│       │   │
│       │   ├── chat/
│       │   │   ├── ChatArea.vue
│       │   │   ├── ChatMessage.vue
│       │   │   ├── ChatInput.vue
│       │   │   ├── ChatToolbar.vue    # 消息工具栏 (复制/重生成/分支)
│       │   │   └── MarkdownRenderer.vue
│       │   │
│       │   ├── diff/
│       │   │   ├── DiffViewer.vue     # Diff主容器
│       │   │   ├── DiffFile.vue
│       │   │   ├── DiffHunk.vue
│       │   │   ├── DiffLine.vue
│       │   │   ├── DiffLineContent.vue
│       │   │   ├── DiffStats.vue
│       │   │   ├── DiffExplanation.vue
│       │   │   └── DiffViewToggle.vue
│       │   │
│       │   ├── flowchart/             # 流程图组件
│       │   │   ├── FlowchartViewer.vue
│       │   │   ├── FlowchartToolbar.vue
│       │   │   ├── StepPlayer.vue     # 分步执行播放器
│       │   │   └── VariableInspector.vue  # 变量查看器
│       │   │
│       │   ├── flow/                  # VueFlow自定义节点
│       │   │   ├── index.ts           # 节点注册
│       │   │   ├── nodes/
│       │   │   │   ├── StartNode.vue
│       │   │   │   ├── EndNode.vue
│       │   │   │   ├── ProcessNode.vue
│       │   │   │   ├── DecisionNode.vue
│       │   │   │   ├── LoopNode.vue
│       │   │   │   ├── FunctionNode.vue
│       │   │   │   ├── IONode.vue
│       │   │   │   ├── ErrorNode.vue
│       │   │   │   ├── CodeNode.vue
│       │   │   │   └── GroupNode.vue
│       │   │   └── edges/
│       │   │       ├── AnimatedEdge.vue
│       │   │       └── LabeledEdge.vue
│       │   │
│       │   ├── markdown/              # Markdown扩展渲染组件
│       │   │   ├── MermaidDiagram.vue
│       │   │   ├── KatexInline.vue
│       │   │   ├── CodeBlock.vue      # 可折叠代码块
│       │   │   └── DiffBlock.vue      # Markdown中的diff块
│       │   │
│       │   ├── code/
│       │   │   ├── CodeViewer.vue
│       │   │   ├── CodeExplainer.vue
│       │   │   ├── SmartTooltip.vue   # 升级版hover tooltip (流式)
│       │   │   └── KeywordTooltip.vue
│       │   │
│       │   └── ui/                    # 基础UI组件
│       │       ├── BaseButton.vue
│       │       ├── BaseInput.vue
│       │       ├── BaseDialog.vue
│       │       ├── BaseDropdown.vue
│       │       ├── BaseToggle.vue
│       │       └── BaseSpinner.vue
│       │
│       └── workers/                   # Web Workers
│           └── markdown.worker.ts     # Markdown解析Worker
│
├── server/                            # Express Backend
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   │
│   └── src/
│       ├── index.ts                   # Express app入口
│       ├── app.ts                     # Express配置 (中间件链)
│       │
│       ├── routes/
│       │   ├── chat.ts                # POST /api/chat/stream
│       │   ├── explanation.ts         # POST /api/explanation/explain
│       │   ├── diff.ts                # POST /api/diff/explain (新增)
│       │   ├── flowchart.ts           # POST /api/flowchart/generate (新增)
│       │   └── index.ts               # 路由聚合
│       │
│       ├── services/
│       │   ├── ai.ts                  # AI SDK封装 (OpenAI-compatible)
│       │   ├── prompts/
│       │   │   ├── chat.ts            # 聊天System Prompt
│       │   │   ├── explanation.ts     # 解释System Prompt
│       │   │   ├── diff.ts            # Diff解释System Prompt (新增)
│       │   │   └── flowchart.ts       # 流程图生成System Prompt (新增)
│       │   └── sse.ts                 # SSE工具函数 (从ai.ts抽离)
│       │
│       ├── middleware/
│       │   ├── error-handler.ts       # 全局错误处理
│       │   ├── rate-limiter.ts        # 请求速率限制
│       │   └── logger.ts             # 请求日志
│       │
│       └── types/
│           └── index.ts               # Server端类型
│
└── shared/                            # 共享代码 (Client + Server)
    ├── package.json
    └── src/
        ├── types/
        │   ├── ai-response.ts         # AI响应类型 (共用)
        │   ├── flowchart.ts           # 流程图类型 (共用)
        │   └── diff.ts                # Diff类型 (共用)
        ├── schemas/
        │   └── flowchart.schema.ts    # Zod Schema (共用)
        └── constants/
            └── prompts.ts             # Prompt模板 (共用)
```

---

# 十、下一阶段扩展方向

## 优先级矩阵

```
影响/可行性矩阵:

              高影响                      低影响
         ┌──────────────────┬──────────────────┐
  容易   │  Monaco Editor   │  键盘快捷键系统   │
  实现   │  插件系统 (核心)  │  导出功能 (PNG/   │
         │  暗色/亮色主题    │   Markdown)       │
         ├──────────────────┼──────────────────┤
  中等   │  AST分析          │  WebSocket协同    │
  实现   │  RAG知识库        │  多Agent协作      │
         ├──────────────────┼──────────────────┤
  困难   │  沙箱代码执行      │  VSCode插件       │
  实现   │  Git集成          │  GitHub Gist同步  │
         └──────────────────┴──────────────────┘
```

## 建议立即做 (Phase 2 — 本方案)

| 功能 | 价值 | 说明 |
|------|------|------|
| Diff对比系统 | **极高** | Cursor核心功能, AI项目标配 |
| 流程图可视化 | **极高** | 差异化亮点, 教育场景刚需 |
| AI结构化输出 | **极高** | 架构基础, 所有功能依赖 |
| 聊天系统升级 | **高** | 消息持久化是基本体验 |
| Markdown系统升级 | **高** | Mermaid/数学公式是AI输出刚需 |

## 建议下一阶段做 (Phase 3)

| 功能 | 价值 | 难度 | 理由 |
|------|------|------|------|
| **Monaco Editor** | 极高 | 中 | IDE体验的核心, 支持语法高亮/智能提示/多光标/代码片段。建议直接集成 `@monaco-editor/loader` |
| **插件系统** | 高 | 中 | 可扩展架构的基础, 适合简历亮点。"微内核+插件"架构, 每个功能 (Diff/Flowchart/Hover) 都是插件 |
| **AST分析** | 高 | 高 | 使用 `@babel/parser` / `tree-sitter` 解析代码AST, 输出结构化分析, 比纯文本AI解释更精准 |

## 适合作为简历亮点的

| 功能 | 面试价值 | 技术深度 | 推荐理由 |
|------|----------|----------|----------|
| **自定义DSL + 插件系统** | ⭐⭐⭐⭐⭐ | 深 | 架构能力的最好证明 |
| **结构化AI输出Pipeline** | ⭐⭐⭐⭐⭐ | 深 | 类型安全+错误恢复+流式解析 |
| **Web Worker + 虚拟滚动** | ⭐⭐⭐⭐ | 中 | 性能优化实战 |
| **VueFlow + dagre自动布局** | ⭐⭐⭐⭐ | 中 | 可视化+算法 |
| **Monaco Editor + AST集成** | ⭐⭐⭐⭐ | 中 | IDE核心技术 |
| **IndexedDB + 消息分支** | ⭐⭐⭐⭐ | 中 | 离线+数据架构 |
| **RAG知识库** | ⭐⭐⭐⭐⭐ | 高 | AI工程化核心能力 |

## 不建议现在做的

| 功能 | 原因 |
|------|------|
| WebSocket协同编辑 | 需要后端协同服务器, 复杂度高, 单用户场景用不上 |
| 多Agent协作 | 需要复杂的Orchestration层, ROI低, 先用单Agent走通 |
| VSCode插件 | 开发成本高, 受众窄, 不如先做好Web端 |
| 沙箱代码执行 | 安全风险大 (Docker隔离), 运维成本高 |

## 推荐Phase 3实施顺序

```
1. Monaco Editor 集成          (1周)
2. 插件系统设计 + 重构现有功能为插件 (2周)
3. RAG知识库 (向量数据库 + 文档嵌入) (2周)
4. AST分析 + 代码质量报告     (1周)
5. 暗色/亮色主题切换          (2天)
6. 导出功能 (PNG/SVG/Markdown) (3天)
```

---

> **总结:** 本方案将MVP升级为Pro版的核心路径是: **结构化输出 → 可视化 → 持久化 → 性能 → 架构分层**。先完成Phase 2的9大模块, 让产品具备Cursor级别的AI代码交互体验; 再通过Phase 3的Monaco Editor和插件系统, 让架构具备真正的可扩展性。
