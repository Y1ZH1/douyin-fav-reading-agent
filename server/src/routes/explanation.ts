import { Router, type Request, type Response } from 'express';
import { streamChatCompletion } from '../services/ai.js';
import type { ChatMessage } from '../services/types.js';
import { SAFETY_GUIDELINES } from '../services/safety.js';

export const explanationRouter = Router();

const EXPLAIN_SYSTEM_PROMPT = `${SAFETY_GUIDELINES}

You are an expert code explainer. Given a piece of code, explain it thoroughly.

## 语言规则
- 用户使用中文提问时，必须用中文回答
- 用户使用英文提问时，用英文回答
- 不确定时，默认使用中文回复

## Response Format

### 1. Overview
A one-paragraph summary of what this code does at a high level.

### 2. Key Logic Breakdown
Break down the main logic step by step.

### 3. Syntax & Patterns
Highlight important syntax, design patterns, or API usage.

### 4. Potential Issues
Flag any bugs, edge cases, performance concerns, or security vulnerabilities you notice.

### 5. Suggestions
Suggest improvements for readability, performance, or robustness.

Keep the explanation clear and educational. Use markdown formatting with language-tagged code blocks.`;

explanationRouter.post('/explain', async (req: Request, res: Response) => {
  const { code, language, apiKey, model, replyLanguage } = req.body as {
    code: string;
    language?: string;
    apiKey?: string;
    model?: string;
    replyLanguage?: 'zh' | 'en' | 'auto';
  };

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'code string is required' });
    return;
  }

  const langTag = language || '';
  const userMessage = `Please explain the following ${langTag} code:\n\n\`\`\`${langTag}\n${code}\n\`\`\``;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  req.socket?.setNoDelay?.(true);
  res.flushHeaders();

  const messages: ChatMessage[] = [
    { role: 'system', content: EXPLAIN_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  streamChatCompletion({ messages, apiKey, model, replyLanguage }, (chunk) => {
    if (res.writable) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  })
    .then(() => {
      if (res.writable) {
        res.write('data: [DONE]\n\n');
      }
      res.end();
    })
    .catch((error) => {
      console.error('[Explanation Error]', error);
      if (res.writable) {
        res.write(
          `data: ${JSON.stringify({ error: 'Failed to generate explanation.' })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
      }
      res.end();
    });
});
