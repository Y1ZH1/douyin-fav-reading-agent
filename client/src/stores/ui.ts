import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUIStore = defineStore('ui', () => {
  const sidebarCollapsed = ref(false)
  const commandPaletteOpen = ref(false)
  const globalLoading = ref(false)
  const toasts = ref<Array<{ id: string; message: string; type: 'info' | 'success' | 'error'; timestamp: number }>>([])

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function toggleCommandPalette() {
    commandPaletteOpen.value = !commandPaletteOpen.value
  }

  function addToast(message: string, type: 'info' | 'success' | 'error' = 'info') {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    toasts.value.push({ id, message, type, timestamp: Date.now() })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 4000)
  }

  return {
    sidebarCollapsed,
    commandPaletteOpen,
    globalLoading,
    toasts,
    toggleSidebar,
    toggleCommandPalette,
    addToast,
  }
})
