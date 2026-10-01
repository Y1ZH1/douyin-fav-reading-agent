export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  /** 用户自定义 API Key，为空时使用服务端 .env 配置 */
  apiKey?: string;
  /** 用户自定义模型名，为空时使用服务端 .env 配置 */
  model?: string;
  /** 回复语言: zh=中文 en=英文 auto=跟随用户输入（默认），为空时同 auto */
  replyLanguage?: 'zh' | 'en' | 'auto';
}

export interface StreamChunk {
  content?: string;
  reasoning?: string;
}

export interface ExplanationRequest {
  code: string;
  language?: string;
  question?: string;
}

export interface SSEEvent {
  event: string;
  data: unknown;
}
