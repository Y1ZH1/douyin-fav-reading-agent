import { Router, type Request, type Response } from 'express'
import { streamChatCompletion } from '../services/ai.js'
import type { ChatMessage } from '../services/types.js'
import { SAFETY_GUIDELINES } from '../services/safety.js'

export const diffRouter = Router()

const DIFF_SYSTEM_PROMPT = `${SAFETY_GUIDELINES}

You are an expert code reviewer. Analyze the provided code diff and output a structured JSON explanation.

## 语言规则
- 默认使用中文回复
- 如果用户的消息是英文，则用英文回复
- JSON 中所有文本字段（summary、title、detail、learningPoints）都使用对应的语言

## Output format (strict JSON, no markdown wrapping)
{
  "summary": "用一句话概括整体的变更",
  "sections": [
    {
      "hunkId": "请使用用户提供的实际 hunk ID",
      "title": "此变更的简短标题",
      "detail": "详细说明改了什么、为什么这样改",
      "severity": "info",
      "learningPoints": ["知识点1", "知识点2"]
    }
  ]
}

## Example
Input diff:
\`\`\`
-function add(a, b) {
-  return a * b
+function add(a, b) {
+  return a + b
\`\`\`

Expected output:
{
  "summary": "修复了 add 函数的运算逻辑",
  "sections": [
    {
      "hunkId": "填实际 hunk ID",
      "title": "修复乘法错误",
      "detail": "将 add 函数中的乘法运算符替换为加法，修复了逻辑错误。",
      "severity": "critical",
      "learningPoints": ["运算优先级", "加法 vs 乘法"]
    }
  ]
}

Severity levels:
- "info": 安全的重构或表面性变更
- "warning": 需要注意的行为变更
- "critical": 潜在的 bug、安全问题或破坏性变更`

diffRouter.post('/explain', async (req: Request, res: Response) => {
  const { oldCode, newCode, language, hunks, apiKey, model, replyLanguage } = req.body as {
    oldCode: string
    newCode: string
    language?: string
    hunks?: { id: string; oldStart: number; newStart: number }[]
    apiKey?: string
    model?: string
    replyLanguage?: 'zh' | 'en' | 'auto'
  }

  if (!oldCode || !newCode) {
    res.status(400).json({ error: 'oldCode and newCode are required' })
    return
  }

  const langTag = language || ''

  // 构建 hunk 参考指南，以便 AI 在其 JSON 输出中使用真实 ID
  let hunkGuide = ''
  if (hunks && hunks.length > 0) {
    hunkGuide = `\n\nThe diff contains the following hunks — use these exact hunk IDs in your JSON output:\n`
    hunkGuide += hunks.map((h) => `  - ${h.id} (lines ${h.oldStart}-${h.newStart})`).join('\n')
  }

  const userMessage = `Explain the differences between the original and modified ${langTag} code:

=== ORIGINAL ===
\`\`\`${langTag}
${oldCode}
\`\`\`

=== MODIFIED ===
\`\`\`${langTag}
${newCode}
\`\`\`${hunkGuide}`

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  req.socket?.setNoDelay?.(true);
  res.flushHeaders();

  const messages: ChatMessage[] = [
    { role: 'system', content: DIFF_SYSTEM_PROMPT },
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
      console.error('[Diff Error]', error)
      if (res.writable) {
        res.write(`data: ${JSON.stringify({ error: 'Failed to generate diff explanation.' })}\n\n`)
        res.write('data: [DONE]\n\n')
      }
      res.end()
    })
})
