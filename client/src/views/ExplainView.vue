<script setup lang="ts">
import { ref } from 'vue';
import Sidebar from '@/components/layout/Sidebar.vue';
import CodeExplainer from '@/components/code/CodeExplainer.vue';
import { ArrowLeft, Code2 } from 'lucide-vue-next';
import { useRouter } from 'vue-router';

const router = useRouter();
const sidebarCollapsed = ref(false);

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-background">
    <Sidebar :collapsed="sidebarCollapsed" @toggle="toggleSidebar" />
    <main class="flex-1 flex flex-col min-w-0">
      <!-- 头部 -->
      <div class="flex items-center gap-3 px-4 py-3 border-b border-border">
        <button
          class="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          @click="router.push('/')"
        >
          <ArrowLeft class="h-4 w-4" />
        </button>
        <div class="flex items-center gap-2">
          <Code2 class="h-4 w-4 text-primary" />
          <h2 class="text-sm font-semibold text-foreground">代码分析</h2>
        </div>
      </div>

      <!-- 内容区域 -->
      <div class="flex-1 overflow-y-auto">
        <div class="max-w-3xl mx-auto px-4 py-6">
          <div class="mb-6">
            <h1 class="text-lg font-semibold text-foreground mb-1">AI 代码分析</h1>
            <p class="text-sm text-muted-foreground">
              粘贴代码，选择分析维度，获得多维度的 AI 代码分析报告。
            </p>
          </div>
          <CodeExplainer />
        </div>
      </div>
    </main>
  </div>
</template>
