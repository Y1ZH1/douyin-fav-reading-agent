import { diffLines, diffWords } from 'diff'
import type { DiffFile, DiffHunk, DiffLine, WordChange } from '@/types/diff'
import { generateId } from '@/lib/utils'

const CONTEXT_LINES = 3

export function buildDiff(
  oldCode: string,
  newCode: string,
  language = 'text',
  oldPath = 'before',
  newPath = 'after',
): DiffFile {
  const changes = diffLines(oldCode, newCode)
  const hunks: DiffHunk[] = []
  let oldLineNum = 1
  let newLineNum = 1
  let additions = 0
  let deletions = 0
  let pendingHunk: DiffHunk | null = null

  function createHunk(): DiffHunk {
    return {
      id: generateId(),
      oldStart: oldLineNum,
      newStart: newLineNum,
      oldLines: 0,
      newLines: 0,
      lines: [],
    }
  }

  function flushHunk() {
    if (pendingHunk) {
      hunks.push(pendingHunk)
      pendingHunk = null
    }
  }

  for (const change of changes) {
    const lines = change.value.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()

    if (change.added) {
      if (!pendingHunk) pendingHunk = createHunk()
      for (const line of lines) {
        pendingHunk.lines.push({
          id: generateId(),
          type: 'add',
          newLineNumber: newLineNum++,
          content: line,
        })
        additions++
        pendingHunk.newLines++
      }
    } else if (change.removed) {
      if (!pendingHunk) pendingHunk = createHunk()
      for (const line of lines) {
        pendingHunk.lines.push({
          id: generateId(),
          type: 'delete',
          oldLineNumber: oldLineNum++,
          content: line,
        })
        deletions++
        pendingHunk.oldLines++
      }
    } else {
      const contextLines: DiffLine[] = lines.map((line: string) => ({
        id: generateId(),
        type: 'context' as const,
        oldLineNumber: oldLineNum++,
        newLineNumber: newLineNum++,
        content: line,
      }))

      if (pendingHunk) {
        pendingHunk.lines.push(...contextLines)
        const contextCount = pendingHunk.lines.filter((l: DiffLine) => l.type === 'context').length
        if (contextCount > CONTEXT_LINES * 2) {
          flushHunk()
        }
      }
    }
  }

  flushHunk()

  // 后处理：为相邻的 delete+add 对计算词级差异
  for (const hunk of hunks) {
    for (let i = 0; i < hunk.lines.length; i++) {
      const line = hunk.lines[i]
      if (line.type === 'delete') {
        const nextLine = hunk.lines[i + 1]
        if (nextLine?.type === 'add') {
          const wordDiff = diffWords(line.content, nextLine.content)
          const words: WordChange[] = wordDiff.map((w: { added?: boolean; removed?: boolean; value: string }) => ({
            type: w.added ? 'add' as const : w.removed ? 'delete' as const : 'equal' as const,
            text: w.value,
          }))
          line.wordChanges = words
          nextLine.wordChanges = words
        }
      }
    }
  }

  return {
    id: generateId(),
    oldPath,
    newPath,
    language,
    hunks,
    stats: { additions, deletions, filesChanged: 1 },
  }
}
