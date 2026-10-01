import type { TooltipData } from '@/types';

export const KEYWORD_EXPLANATIONS: Record<string, TooltipData> = {
  ref: {
    keyword: 'ref',
    explanation:
      'Creates a reactive reference to a value. In Vue 3, `ref()` wraps a value in a reactive object with a `.value` property. When the value changes, any component using it automatically re-renders.',
    category: 'reactivity',
  },
  reactive: {
    keyword: 'reactive',
    explanation:
      'Creates a deeply reactive object or array. Unlike `ref()`, `reactive()` works directly on objects without needing `.value`. However, it cannot be reassigned and only works with objects.',
    category: 'reactivity',
  },
  computed: {
    keyword: 'computed',
    explanation:
      'Creates a derived reactive value that automatically updates when its dependencies change. Computed values are cached and only recomputed when needed, making them efficient for expensive calculations.',
    category: 'reactivity',
  },
  watch: {
    keyword: 'watch',
    explanation:
      'Observes one or more reactive sources and runs a callback when they change. Use `watch()` for side effects like API calls, DOM updates, or persisting data. Prefer `computed()` for derived state.',
    category: 'reactivity',
  },
  watchEffect: {
    keyword: 'watchEffect',
    explanation:
      'Automatically tracks reactive dependencies used inside the callback and re-runs when any of them change. Simpler than `watch()` but offers less control over old/new values.',
    category: 'reactivity',
  },
  onMounted: {
    keyword: 'onMounted',
    explanation:
      'A lifecycle hook that runs after the component has been mounted to the DOM. Commonly used for initialization, fetching data, or setting up third-party libraries.',
    category: 'lifecycle',
  },
  onUnmounted: {
    keyword: 'onUnmounted',
    explanation:
      'A lifecycle hook that runs when a component is about to be removed from the DOM. Essential for cleanup: clearing timers, unsubscribing from events, or canceling requests.',
    category: 'lifecycle',
  },
  provide: {
    keyword: 'provide',
    explanation:
      'Makes a value available to all descendant components without prop drilling. Used with `inject()` in child components. The provided value can be reactive.',
    category: 'composition',
  },
  inject: {
    keyword: 'inject',
    explanation:
      'Retrieves a value provided by an ancestor component. Used with `provide()` to avoid prop drilling. Always provide a default value for safety.',
    category: 'composition',
  },
  defineProps: {
    keyword: 'defineProps',
    explanation:
      'A compiler macro that declares the props a component accepts. No import needed — it is compiled away by Vue SFC compiler. Use with TypeScript generics for type-safe props.',
    category: 'composition',
  },
  defineEmits: {
    keyword: 'defineEmits',
    explanation:
      'A compiler macro that declares the events a component can emit. No import needed. Use with TypeScript for type-safe event payloads.',
    category: 'composition',
  },
  await: {
    keyword: 'await',
    explanation:
      'Pauses async function execution until a Promise resolves. Makes async code read like synchronous code. Must be used inside an `async` function or at the top level in ES modules.',
    category: 'async',
  },
  async: {
    keyword: 'async',
    explanation:
      'Declares a function that returns a Promise. Inside async functions, you can use `await` to pause execution until Promises resolve. Errors can be caught with try/catch.',
    category: 'async',
  },
  defineExpose: {
    keyword: 'defineExpose',
    explanation:
      'A compiler macro that explicitly declares what properties/methods are accessible via template refs from the parent component. By default, nothing is exposed in `<script setup>`.',
    category: 'composition',
  },
  vModel: {
    keyword: 'v-model',
    explanation:
      'A directive for two-way data binding between a form input and component state. Syntactic sugar for `:value` + `@input`. Can be used with composables via `defineModel()`.',
    category: 'directive',
  },
};

export function getKeywordExplanation(keyword: string): TooltipData | null {
  return KEYWORD_EXPLANATIONS[keyword] ?? null;
}

export function getAllKeywords(): string[] {
  return Object.keys(KEYWORD_EXPLANATIONS);
}
