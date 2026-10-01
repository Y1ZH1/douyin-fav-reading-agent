import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { AppSettings } from '@/types';

const STORAGE_KEY = 'ai-code-tutor-settings';

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...getDefaultSettings(), ...JSON.parse(raw) };
  } catch {
    // 忽略解析错误
  }
  return getDefaultSettings();
}

function getDefaultSettings(): AppSettings {
  return {
    theme: 'dark',
    fontSize: 'medium',
    showLineNumbers: true,
    autoScroll: true,
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    language: 'auto',
    jevThreshold: 0.72,
    jevMinGap: 0.08,
    explainPrompt: '',
    summarizePrompt: '',
    memoryWindowDays: 14,
  };
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>(loadSettings());

  watch(
    settings,
    (val) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
    },
    { deep: true },
  );

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    settings.value[key] = value;
  }

  function reset() {
    settings.value = getDefaultSettings();
  }

  return {
    settings,
    update,
    reset,
  };
});
