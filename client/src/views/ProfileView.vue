<script setup lang="ts">
import Sidebar from '@/components/layout/Sidebar.vue'
import { ref } from 'vue'
const sidebarCollapsed = ref(false)
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-background">
    <Sidebar :collapsed="sidebarCollapsed" @toggle="sidebarCollapsed = !sidebarCollapsed" />
    <main class="flex-1 flex flex-col min-w-0">
      <h1>个人资料</h1>
    </main>
  </div>
</template>