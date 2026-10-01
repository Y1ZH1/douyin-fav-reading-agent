const LANGUAGE_PATTERNS: [string, RegExp][] = [
  ['typescript', /\b(interface|type)\s+\w+\s*[=({]|:\s*(string|number|boolean|void|any|never|unknown)\b/],
  ['tsx', /import\s+React\b|<\/[A-Z]\w*>|<[A-Z]\w+\s|useState|useEffect|useRef/],
  ['jsx', /import\s+React\b|<\/[A-Z]\w*>|<[A-Z]\w+\s|useState|useEffect/],
  ['javascript', /\b(const|let|var)\s+\w+\s*=|function\s+\w+\s*\(|=>\s*\{/],
  ['python', /\bdef\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import|print\(|elif\b|class\s+\w+:/],
  ['go', /\bpackage\s+main\b|\bfunc\s+\w+\s*\(|fmt\.Print|:=/],
  ['rust', /\bfn\s+\w+\s*\(|let\s+mut\b|impl\b|use\s+std::/],
  ['java', /\bpublic\s+(static\s+)?(void|class|int|String)\b|System\.out\.print/],
  ['csharp', /\bnamespace\s+\w+|using\s+System\b|public\s+class\b|Console\.(Write|Read)/],
  ['cpp', /#include\s*<|std::|template\s*</],
  ['c', /#include\s*<\w+\.h>/],
  ['markdown', /^#{1,6}\s+\w+/m],
  ['html', /<!DOCTYPE\s+html>|<\/?html|<\/?head>|<\/?body>|<\/?div>/i],
  ['css', /[.#]\w+\s*\{|@media\b|@import\b|font-size\s*:|color\s*:|margin\s*:|padding\s*:/],
  ['json', /^\s*\{\s*"\w+"\s*:/m],
  ['php', /<\?php|echo\s+|function\s+\w+\s*\(.*\)\s*\{/],
  ['ruby', /\bdef\s+\w+\s*$|puts\s+|require\s+'/],
  ['swift', /\bvar\s+\w+\s*:\s*\w+\b|func\s+\w+\s*\(|import\s+Foundation/],
  ['kotlin', /\bfun\s+\w+\s*\(.*\)\s*:\s*\w+\s*\{|val\s+\w+\s*:\s*\w+|println\(/],
  ['scala', /\bval\s+\w+\s*:\s*\w+\s*=|def\s+\w+\s*\(.*\)\s*:\s*\w+\s*=/],
  ['sql', /\bSELECT\s+|FROM\s+\w+|WHERE\s+|INSERT\s+INTO\b|CREATE\s+TABLE\b|ALTER\s+TABLE\b/i],
  ['yaml', /^\w+:\s*\w+/m],
  ['graphql', /\bquery\s+\w+\s*\{|\bmutation\s+\w+\s*\{|type\s+\w+\s*\{/],
  ['bash', /^#!\/bin\/(bash|sh|zsh)|^(apt(-get)?|npm|yarn|pnpm|pip|git)\s/m],
  ['vue', /<template>|<script\s+setup>|defineProps|defineEmits/],
]

export function detectLanguage(code: string): string {
  if (!code?.trim()) return ''

  let bestLang = ''
  let bestScore = 0

  for (const [lang, pattern] of LANGUAGE_PATTERNS) {
    const matches = code.match(new RegExp(pattern.source, pattern.flags.includes('i') ? 'gim' : 'gm'))
    const score = matches ? matches.length : 0
    if (score > bestScore) {
      bestScore = score
      bestLang = lang
    }
  }

  return bestScore > 0 ? bestLang : ''
}
