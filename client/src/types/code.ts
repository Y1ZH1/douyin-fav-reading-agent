export interface TooltipData {
  keyword: string;
  explanation: string;
  category: KeywordCategory;
}

export type KeywordCategory =
  | 'reactivity'
  | 'lifecycle'
  | 'composition'
  | 'async'
  | 'builtin'
  | 'directive';
