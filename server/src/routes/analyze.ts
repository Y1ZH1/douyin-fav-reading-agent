import { Router, type Request, type Response } from 'express'
import { streamChatCompletion } from '../services/ai.js'
import type { ChatMessage } from '../services/types.js'
import { SAFETY_GUIDELINES } from '../services/safety.js'

export const analyzeRouter = Router()

interface AnalyzeRequest {
  files: { name: string; content: string }[]
  modes: string[]
  language?: string
}

// 各分析维度的系统提示
const MODE_PROMPTS: Record<string, string> = {
  explanation: `### 代码解释
1. **概述**：用一段话概括这段代码的功能和目的
2. **关键逻辑分解**：逐步拆解核心逻辑
3. **语法与模式**：指出的关键语法、设计模式或 API 用法`,
  review: `### 代码审查
1. **Bug 风险**：指出可能导致错误或异常退出的代码（标注严重程度：🔴 高 / 🟡 中 / 🟢 低）
2. **反模式与代码异味**：指出不合理的设计、重复代码、过长函数等
3. **类型安全**：检查类型使用是否合理、是否存在潜在的空值访问`,
  architecture: `### 架构分析
1. **整体结构**：分析代码的模块划分、依赖关系
2. **设计模式**：识别使用了哪些设计模式，或建议可以使用的模式
3. **可扩展性**：评估代码的可扩展性和可维护性`,
  optimization: `### 性能优化
1. **时间复杂度**：分析关键算法的时间/空间复杂度
2. **性能瓶颈**：指出可能的性能瓶颈（不必要的循环、重复计算、IO 阻塞等）
3. **优化建议**：给出具体的优化方案和预期收益`,
  security: `### 安全分析
1. **注入风险**：检查 SQL 注入、命令注入、XSS 等风险
2. **权限与认证**：检查权限控制、敏感数据处理是否合理
3. **依赖安全**：关注第三方依赖、不安全的配置等`,
}

function buildSystemPrompt(modes: string[]): string {
  const selectedModes = modes.filter((m) => MODE_PROMPTS[m])
  if (selectedModes.length === 0) {
    selectedModes.push('explanation')
  }

  const sections = selectedModes.map((m) => MODE_PROMPTS[m]).join('\n\n')

  return `${SAFETY_GUIDELINES}

你是一位资深代码分析专家。请对用户提供的代码进行多维度分析。

## 语言规则
- 如果用户使用中文，请用中文回复
- 如果用户使用英文，请用英文回复
- 默认使用中文回复

## 分析维度

${sections}

## 输出格式
- 使用 Markdown 格式，带语言标记的代码块
- 每个维度使用 ## 二级标题
- 问题点使用有序列表，标注严重程度
- 提供具体的代码示例和行号引用
- 最后给出一个**总结**部分，列出最关键的 3-5 条发现

请保持分析清晰、深入、有教育意义。对于代码审查类的问题，请给出具体的修改建议。`
}

analyzeRouter.post('/', async (req: Request, res: Response) => {
  const { files, modes, apiKey, model, replyLanguage } = req.body as AnalyzeRequest & {
    apiKey?: string
    model?: string
    replyLanguage?: 'zh' | 'en' | 'auto'
  }

  if (!files || !Array.isArray(files) || files.length === 0) {
    res.status(400).json({ error: 'files array is required and must not be empty' })
    return
  }

  // 构建带文件标签的用户消息
  const fileSections = files
    .map((f) => {
      const langTag = f.name.split('.').pop() || ''
      return `**文件: ${f.name}**\n\n\`\`\`${langTag}\n${f.content}\n\`\`\``
    })
    .join('\n\n---\n\n')

  const modeLabels = (modes || []).join('、') || '代码解释'
  const userMessage = `请从以下维度分析代码：${modeLabels}\n\n${fileSections}`

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  req.socket?.setNoDelay?.(true)
  res.flushHeaders()

  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(modes || []) },
    { role: 'user', content: userMessage },
  ]

  streamChatCompletion({ messages, apiKey, model, replyLanguage }, (chunk) => {
    if (res.writable) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    }
  })
    .then(() => {
      if (res.writable) {
        res.write('data: [DONE]\n\n')
      }
      res.end()
    })
    .catch((error) => {
      console.error('[Analyze Error]', error)
      if (res.writable) {
        res.write(`data: ${JSON.stringify({ error: '分析失败，请稍后重试。' })}\n\n`)
        res.write('data: [DONE]\n\n')
      }
      res.end()
    })
})
