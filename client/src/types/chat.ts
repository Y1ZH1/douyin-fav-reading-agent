import type { AIResponseType } from './ai-response'

export type MessageStatus =
  | 'pending'
  | 'sending'
  | 'streaming'
  | 'done'
  | 'error'
  | 'aborted'
  | 'regenerating'
  | 'edited'

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface MessageMetadata {
  model: string
  temperature: number
  responseType?: AIResponseType
  latencyMs?: number
  totalLatencyMs?: number
  structuredData?: unknown
}

export interface ChatMessage {
  id: string
  sessionId?: string
  role: MessageRole
  content: string
  reasoningContent?: string
  timestamp: number
  status: MessageStatus
  tokenCount?: number
  metadata?: MessageMetadata
  parentId?: string
  childrenIds?: string[]
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  messageCount: number
  pinned: boolean
  tags: string[]
  model: string
  systemPrompt?: string
  videoName?: string
  attachedAwemeIds?: string[]
}

export interface StreamChunk {
  content: string
}
