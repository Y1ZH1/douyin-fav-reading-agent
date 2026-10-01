/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

declare module 'markdown-it-container' {
  import type MarkdownIt from 'markdown-it'
  const container: (
    md: MarkdownIt,
    name: string,
    options: {
      validate?: (name: string) => boolean
      render?: (tokens: { nesting: number; info: string }[], idx: number) => string
      marker?: string
    },
  ) => void
  export default container
}

declare module 'markdown-it-katex' {
  import type MarkdownIt from 'markdown-it'
  const plugin: (md: MarkdownIt, options?: { throwOnError?: boolean; errorColor?: string }) => void
  export default plugin
}

declare module 'markdown-it-attrs' {
  import type MarkdownIt from 'markdown-it'
  const plugin: (md: MarkdownIt) => void
  export default plugin
}

declare module 'diff' {
  export interface Change {
    value: string
    added?: boolean
    removed?: boolean
  }
  export function diffLines(oldStr: string, newStr: string): Change[]
  export function diffWords(oldStr: string, newStr: string): Change[]
  export function diffChars(oldStr: string, newStr: string): Change[]
}
