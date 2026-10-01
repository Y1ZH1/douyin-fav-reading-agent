import { Router, type Request, type Response } from 'express';
import { streamChatCompletion, buildSystemPrompt } from '../services/ai.js';
import type { ChatMessage } from '../services/types.js';

export const chatRouter = Router();

chatRouter.post('/stream', (req: Request, res: Response) => {
  const { messages, apiKey, model, replyLanguage } = req.body as {
    messages: ChatMessage[];
    apiKey?: string;
    model?: string;
    replyLanguage?: 'zh' | 'en' | 'auto';
  };

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  req.socket?.setNoDelay?.(true);
  res.flushHeaders();

  const systemMsg: ChatMessage = {
    role: 'system',
    content: buildSystemPrompt(),
  };

  streamChatCompletion(
    { messages: [systemMsg, ...messages], apiKey, model, replyLanguage },
    (chunk) => {
      if (res.writable) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
    },
  )
    .then(() => {
      if (res.writable) {
        res.write('data: [DONE]\n\n');
      }
      res.end();
    })
    .catch((error: unknown) => {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[Chat Stream Error]', errMsg);
      if (res.writable) {
        res.write(
          `data: ${JSON.stringify({ error: `AI service error: ${errMsg}` })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
      }
      res.end();
    });
});
