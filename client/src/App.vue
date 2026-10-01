<script setup lang="ts">
import { watch, defineAsyncComponent } from 'vue'
import { RouterView } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { storeToRefs } from 'pinia'

// 懒加载初始渲染不需要的组件
const CommandPalette = defineAsyncComponent(
  () => import('@/components/layout/CommandPalette.vue'),
)

const settingsStore = useSettingsStore()
const { settings } = storeToRefs(settingsStore)

// 监听主题变化，动态切换 dark class
watch(
  () => settings.value.theme,
  (theme) => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  },
  { immediate: true },
)

// 监听字体大小变化，设置 data-font-size 属性
watch(
  () => settings.value.fontSize,
  (fontSize) => {
    document.documentElement.setAttribute('data-font-size', fontSize)
  },
  { immediate: true },
)
</script>

<template>
  <RouterView />
  <CommandPalette />
</template>
