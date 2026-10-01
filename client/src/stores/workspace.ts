import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface WorkspaceTab {
  id: string
  type: 'chat' | 'diff' | 'explain' | 'settings'
  label: string
  icon: string
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const activeTab = ref<string>('chat')
  const tabs = ref<WorkspaceTab[]>([
    { id: 'chat', type: 'chat', label: 'Chat', icon: 'MessageSquare' },
  ])

  function openTab(tab: WorkspaceTab) {
    const existing = tabs.value.find((t) => t.id === tab.id)
    if (!existing) {
      tabs.value.push(tab)
    }
    activeTab.value = tab.id
  }

  function closeTab(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx === -1 || tabs.value.length <= 1) return
    tabs.value.splice(idx, 1)
    if (activeTab.value === id) {
      activeTab.value = tabs.value[Math.min(idx, tabs.value.length - 1)].id
    }
  }

  function setActiveTab(id: string) {
    activeTab.value = id
  }

  return { activeTab, tabs, openTab, closeTab, setActiveTab }
})
