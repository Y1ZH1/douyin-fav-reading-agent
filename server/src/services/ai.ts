import https from 'node:https';
import type { ChatCompletionRequest, ChatMessage, StreamChunk } from './types.js';
import { SAFETY_GUIDELINES, checkInputSafety, checkOutputSafety } from './safety.js';

/** 服务端默认 API Key（来自 .env），用户未传入时使用 */
const DEFAULT_API_KEY = process.env.OPENAI_API_KEY || '';
/** 服务端默认 API 地址（来自 .env） */
const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.deepseek.com';
/** 服务端默认模型（来自 .env），用户未传入时使用 */
const DEFAULT_MODEL = process.env.AI_MODEL || 'deepseek-v4-flash';

/**
 * 根据用户的语言偏好构建语言指令，注入到 System Prompt 顶部。
 * - zh: 强制中文
 * - en: 强制英文
 * - auto / 未设置: 跟随用户输入语言（保留 System Prompt 原有的"语言规则"）
 */
function buildLanguageDirective(language?: string): string | null {
  if (language === 'zh') {
    return `## 语言规则
- 用中文回答所有问题
- 代码块中的注释和文档可以使用代码本身的语言
- 无论用户使用什么语言，始终用中文回复`
  }
  if (language === 'en') {
    return `## Language Rules
- Answer all questions in English
- Code comments and documentation may use the language of the code itself
- No matter which language the user uses, always reply in English`
  }
  return null // auto → 不注入额外指令，使用 System Prompt 自带的规则
}

export function streamChatCompletion(
  request: ChatCompletionRequest,
  onChunk: (chunk: StreamChunk) => void,
): Promise<void> {
  // 用户自定义 Key/Model 优先，否则使用服务端 .env 配置
  const apiKey = request.apiKey || DEFAULT_API_KEY;
  const model = request.model || DEFAULT_MODEL;
  const baseUrl = DEFAULT_BASE_URL;

  // 如果 replyLanguage 为 zh 或 en，注入覆盖性语言指令到 system message
  const directive = buildLanguageDirective(request.replyLanguage);
  let messages: ChatMessage[] = request.messages;
  if (directive) {
    messages = request.messages.map((msg) => {
      if (msg.role === 'system') {
        return { ...msg, content: directive + '\n\n' + msg.content }
      }
      return msg
    })
  }

  // ── 输入安全检查：拦截明显违规/越狱请求 ──
  const inputCheck = checkInputSafety(messages)
  if (!inputCheck.safe) {
    return Promise.reject(new Error(inputCheck.reason || '输入内容违规'))
  }

  return new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error('未配置 API 密钥。请在设置页面填写，或在服务端 .env 文件中配置 OPENAI_API_KEY'));
      return;
    }

    const url = new URL(baseUrl);
    const payload = JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens ?? 4096,
    });

    console.log(`[AI] Fetching ${baseUrl}/chat/completions with model=${model} (key=${request.apiKey ? 'user-provided' : 'server-env'})`);

    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: '/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          Accept: 'text/event-stream',
        },
        timeout: 120_000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => reject(new Error(`API error ${res.statusCode}: ${body}`)));
          return;
        }

        let buffer = '';
        let fullResponse = ''; // 收集完整输出用于后续安全检查
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;

            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') {
              // ── 输出安全检查 ──
              const outputCheck = checkOutputSafety(fullResponse);
              if (outputCheck.hasWarning) {
                console.warn(`[Safety] AI output flagged: ${outputCheck.warnings.join('; ')}`);
              }
              resolve();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;

              if (delta?.content) {
                fullResponse += delta.content;
                onChunk({ content: delta.content });
              }
              if (delta?.reasoning_content) {
                onChunk({ reasoning: delta.reasoning_content });
              }
            } catch {
              // 跳过无法解析的数据块
            }
          }
        });

        res.on('end', () => {
          // ── 输出安全检查（流式结束但未收到 [DONE] 时）──
          if (fullResponse.length > 0) {
            const outputCheck = checkOutputSafety(fullResponse);
            if (outputCheck.hasWarning) {
              console.warn(`[Safety] AI output flagged (on end): ${outputCheck.warnings.join('; ')}`);
            }
          }
          resolve();
        });
        res.on('error', (err) => reject(err));
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

export function chatCompletion(
  request: ChatCompletionRequest,
): Promise<string> {
  const apiKey = request.apiKey || DEFAULT_API_KEY;
  const model = request.model || DEFAULT_MODEL;
  const baseUrl = DEFAULT_BASE_URL;
  const messages = request.messages;

  return new Promise((resolve, reject) => {
    if (!apiKey) {
      reject(new Error('未配置 API 密钥。请在设置页面填写，或在服务端 .env 文件中配置 OPENAI_API_KEY'));
      return;
    }
    const url = new URL(baseUrl);
    const payload = JSON.stringify({
      model,
      messages,
      stream: false,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.max_tokens ?? 2048,
    });
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: '/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 120_000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`API error ${res.statusCode}: ${body}`));
            return;
          }
          try {
            const parsed = JSON.parse(body);
            resolve(parsed.choices?.[0]?.message?.content ?? '');
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export function buildSystemPrompt(customPrompt?: string): string {
  const basePrompt =
    customPrompt ??
    `You are an expert programming tutor. You help users understand code deeply.

## 语言规则
- 用户使用中文提问时，必须用中文回答
- 用户使用英文提问时，用英文回答
- 代码块中的注释和文档可以使用代码本身的语言
- 不确定时，默认使用中文回复

When explaining code:
- Break down complex logic into simple steps.
- Highlight key syntax and patterns.
- Point out potential issues or edge cases.
- Use clear examples.
- Format code blocks with the appropriate language tag.

Be concise but thorough. Your goal is to help the user truly understand, not just give answers.`

  return `${SAFETY_GUIDELINES}\n\n${basePrompt}`
}
