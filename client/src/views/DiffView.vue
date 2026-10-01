<script setup lang="ts">
import { ref } from 'vue'
import DiffViewer from '@/components/diff/DiffViewer.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import { ArrowLeft, GitCompare } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

const router = useRouter()
const sidebarCollapsed = ref(false)

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-background">
    <Sidebar :collapsed="sidebarCollapsed" @toggle="toggleSidebar" />
    <main class="flex-1 flex flex-col min-w-0">
      <div class="flex items-center gap-3 px-4 py-3 border-b border-border">
        <button
          class="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          @click="router.push('/')"
        >
          <ArrowLeft class="h-4 w-4" />
        </button>
        <div class="flex items-center gap-2">
          <GitCompare class="h-4 w-4 text-primary" />
          <h2 class="text-sm font-semibold text-foreground">代码差异</h2>
        </div>
      </div>
      <div class="flex-1 min-h-0">
        <DiffViewer />
      </div>
    </main>
  </div>
</template>
