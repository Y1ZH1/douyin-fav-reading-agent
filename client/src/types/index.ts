export * from './chat'
export * from './agent'
export type { AIResponseType } from './ai-response'
export * from './code'
export * from './diff'

export interface AppSettings {
  theme: 'dark' | 'light'
  fontSize: 'small' | 'medium' | 'large'
  showLineNumbers: boolean
  autoScroll: boolean
  apiKey: string
  baseUrl: string
  model: string
  /** 回复语言: zh=中文 en=英文 auto=跟随用户输入（默认） */
  language: 'zh' | 'en' | 'auto'
  jevThreshold: number
  jevMinGap: number
  explainPrompt: string
  summarizePrompt: string
  /** memory 编译的回溯窗口（天）。默认 14。 */
  memoryWindowDays: number
}
