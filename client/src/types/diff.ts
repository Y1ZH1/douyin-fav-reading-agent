export interface DiffStats {
  additions: number
  deletions: number
  filesChanged: number
}

export interface WordChange {
  type: 'add' | 'delete' | 'equal'
  text: string
}

export interface DiffLine {
  id: string
  type: 'add' | 'delete' | 'context' | 'header'
  oldLineNumber?: number
  newLineNumber?: number
  content: string
  wordChanges?: WordChange[]
}

export interface DiffHunk {
  id: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface AIExplanationSection {
  hunkId: string
  title: string
  detail: string
  severity: 'info' | 'warning' | 'critical'
  learningPoints?: string[]
}

export interface AIExplanation {
  summary: string
  sections: AIExplanationSection[]
}

export interface DiffFile {
  id: string
  oldPath: string
  newPath: string
  language: string
  hunks: DiffHunk[]
  stats: DiffStats
  explanation?: AIExplanation
}

export type DiffViewMode = 'unified' | 'split'
