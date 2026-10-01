<script setup lang="ts">
/**
 * 设置页。
 *
 * 分三块：
 *  1. 阅读 Agent —— 划线动作提示词、Jev 阈值、memory.md、检索与向量
 *  2. 模型 —— API key / 模型 / 回复语言
 *  3. 旧导师遗留 —— 「显示行号 / 自动滚动」这些是代码导师页面的设置，
 *     那套页面已经从导航里拿掉（源码按规格保留）。这里折叠起来，
 *     不删，也不占主视觉。
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ArrowLeft, Settings } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import VectorPanel from '@/components/agent/VectorPanel.vue'
import MemoryPanel from '@/components/agent/MemoryPanel.vue'

const router = useRouter()
const settingsStore = useSettingsStore()
const { settings } = storeToRefs(settingsStore)

onMounted(() => {
  // 保证至少有一次写入，方便确认 localStorage 里确实有这些键
  if (settings.value.memoryWindowDays === undefined) settingsStore.update('memoryWindowDays', 14)
})
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-background">
    <main class="flex min-w-0 flex-1 flex-col">
      <div class="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
          @click="router.push('/')"
        >
          <ArrowLeft class="h-4 w-4" />
        </button>
        <div class="flex items-center gap-2">
          <Settings class="h-4 w-4 text-primary" />
          <h2 class="text-sm font-semibold text-foreground">设置</h2>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div class="mx-auto max-w-2xl space-y-10 px-4 py-8">
          <!-- 阅读 Agent -->
          <div class="space-y-8">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              阅读 Agent
            </h2>

            <section>
              <h3 class="mb-2 text-sm font-semibold text-foreground">划线动作提示词</h3>
              <p class="mb-3 text-xs leading-relaxed text-muted-foreground">
                划线之后点「解释」或「总结」，走的就是这两份提示词。留空则用内置的默认说法。
                划线时临时写的那句如果没留空，也会自动存到这里当默认。
              </p>
              <div class="space-y-4">
                <div>
                  <label class="mb-1 block text-xs text-muted-foreground">解释</label>
                  <textarea
                    :value="settings.explainPrompt"
                    rows="3"
                    placeholder="例如：用一句话说清这段话在讲什么，再给一个反例"
                    class="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs"
                    @input="settingsStore.update('explainPrompt', ($event.target as HTMLTextAreaElement).value)"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-xs text-muted-foreground">总结</label>
                  <textarea
                    :value="settings.summarizePrompt"
                    rows="3"
                    placeholder="例如：先给结论，再列三条依据"
                    class="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs"
                    @input="settingsStore.update('summarizePrompt', ($event.target as HTMLTextAreaElement).value)"
                  />
                </div>
              </div>
            </section>

            <section>
              <h3 class="mb-2 text-sm font-semibold text-foreground">Jev 分类阈值</h3>
              <p class="mb-3 text-xs leading-relaxed text-muted-foreground">
                两道门槛都过才自动写入收藏夹，否则弹卡片让你选。
                只看置信度会让「0.75 对 0.74」这种胶着情况被写错，所以要加间隙这一道。
              </p>
              <div class="space-y-4">
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <span class="text-sm text-foreground">置信度阈值</span>
                    <p class="text-xs text-muted-foreground">低于这个值就问人</p>
                  </div>
                  <input
                    :value="settings.jevThreshold"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    class="w-24 rounded-md border border-border bg-secondary/50 px-2 py-1 text-xs"
                    @change="settingsStore.update('jevThreshold', Number(($event.target as HTMLInputElement).value))"
                  />
                </div>
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <span class="text-sm text-foreground">与第二名的最小间隙</span>
                    <p class="text-xs text-muted-foreground">两个夹子太近就问人</p>
                  </div>
                  <input
                    :value="settings.jevMinGap"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    class="w-24 rounded-md border border-border bg-secondary/50 px-2 py-1 text-xs"
                    @change="settingsStore.update('jevMinGap', Number(($event.target as HTMLInputElement).value))"
                  />
                </div>
              </div>
            </section>

            <MemoryPanel />
            <VectorPanel />
          </div>

          <!-- 模型 -->
          <div class="space-y-6">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              模型
            </h2>
            <section>
              <div class="space-y-4">
                <div>
                  <label class="mb-1 block text-xs text-muted-foreground">API 密钥</label>
                  <input
                    :value="settings.apiKey"
                    type="password"
                    placeholder="留空则使用服务端 .env 里的密钥"
                    class="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    @input="settingsStore.update('apiKey', ($event.target as HTMLInputElement).value)"
                  />
                  <p class="mt-1 text-[10px] text-muted-foreground">
                    只存在本机 localStorage，请求经本机 Node 转发，不经过第三方。
                  </p>
                </div>
                <div>
                  <label class="mb-1 block text-xs text-muted-foreground">模型</label>
                  <input
                    :value="settings.model"
                    placeholder="deepseek-v4-flash"
                    class="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    @input="settingsStore.update('model', ($event.target as HTMLInputElement).value)"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-xs text-muted-foreground">回复语言</label>
                  <select
                    :value="settings.language"
                    class="w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-foreground"
                    @change="settingsStore.update('language', ($event.target as HTMLSelectElement).value as 'zh' | 'en' | 'auto')"
                  >
                    <option value="auto">自动跟随（按你的输入语言）</option>
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>
            </section>
          </div>

          <!-- 外观 -->
          <div class="space-y-6">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              外观
            </h2>
            <section>
              <div class="space-y-4">
                <div class="flex items-center justify-between">
                  <span class="text-sm text-foreground">主题</span>
                  <select
                    :value="settings.theme"
                    class="rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs text-foreground"
                    @change="settingsStore.update('theme', ($event.target as HTMLSelectElement).value as 'dark' | 'light')"
                  >
                    <option value="dark">暗黑</option>
                    <option value="light">明亮</option>
                  </select>
                </div>
                <div class="flex items-center justify-between">
                  <span class="text-sm text-foreground">字体大小</span>
                  <select
                    :value="settings.fontSize"
                    class="rounded-md border border-border bg-secondary/50 px-3 py-1.5 text-xs text-foreground"
                    @change="settingsStore.update('fontSize', ($event.target as HTMLSelectElement).value as 'small' | 'medium' | 'large')"
                  >
                    <option value="small">小</option>
                    <option value="medium">中</option>
                    <option value="large">大</option>
                  </select>
                </div>
              </div>
            </section>
          </div>

          <!-- 旧导师遗留 -->
          <details class="rounded-lg border border-border/60 px-3 py-2">
            <summary class="cursor-pointer text-xs text-muted-foreground">
              旧代码导师页面的设置（已退役，源码保留）
            </summary>
            <p class="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              「个人简介 / 代码差异 / 代码分析」三个页面已从导航里拿掉，源码按产品规格没有删除。
              下面两项只对那套页面生效，对阅读 Agent 没有影响。
            </p>
            <div class="mt-3 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs text-foreground">显示行号</span>
                <button
                  :class="['relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                    settings.showLineNumbers ? 'bg-primary' : 'bg-secondary']"
                  @click="settingsStore.update('showLineNumbers', !settings.showLineNumbers)"
                >
                  <span
                    :class="['inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                      settings.showLineNumbers ? 'translate-x-[18px]' : 'translate-x-[2px]']"
                  />
                </button>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-xs text-foreground">自动滚动</span>
                <button
                  :class="['relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                    settings.autoScroll ? 'bg-primary' : 'bg-secondary']"
                  @click="settingsStore.update('autoScroll', !settings.autoScroll)"
                >
                  <span
                    :class="['inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                      settings.autoScroll ? 'translate-x-[18px]' : 'translate-x-[2px]']"
                  />
                </button>
              </div>
            </div>
          </details>

          <div class="pt-2">
            <button
              class="text-xs text-destructive transition-colors hover:text-destructive/80"
              @click="settingsStore.reset()"
            >
              重置为默认值
            </button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
