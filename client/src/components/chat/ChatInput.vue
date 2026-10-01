<script setup lang="ts">
import { ref, computed } from 'vue';
import { Send, Square } from 'lucide-vue-next';

const props = defineProps<{
  isGenerating: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  send: [content: string];
  stop: [];
}>();

const inputText = ref('');

const canSend = computed(() => inputText.value.trim().length > 0 && !props.isGenerating);

function handleSubmit() {
  if (!canSend.value) return;
  emit('send', inputText.value);
  inputText.value = '';
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSubmit();
  }
}

function autoResize(e: Event) {
  const ta = e.target as HTMLTextAreaElement;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
}
</script>

<template>
  <div class="border-t border-border bg-background/80 backdrop-blur-sm">
    <div class="max-w-3xl mx-auto px-4 py-3">
      <div class="flex items-end gap-2 bg-secondary/50 rounded-xl border border-border px-4 py-2 focus-within:border-ring/50 transition-colors">
        <textarea
          v-model="inputText"
          :disabled="isGenerating || disabled"
          placeholder="询问任何关于代码的问题..."
          rows="1"
          class="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none py-1.5 max-h-[200px]"
          @keydown="handleKeydown"
          @input="autoResize"
        />
        <div class="flex items-center gap-1 shrink-0">
          <button
            v-if="isGenerating"
            class="flex items-center justify-center h-8 w-8 rounded-lg bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors"
            title="停止生成"
            @click="emit('stop')"
          >
            <Square class="h-3.5 w-3.5" />
          </button>
          <button
            v-else
            :disabled="!canSend"
            class="flex items-center justify-center h-8 w-8 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="发送消息"
            @click="handleSubmit"
          >
            <Send class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <p class="text-[10px] text-muted-foreground/50 text-center mt-2">
        Enter 发送，Shift+Enter 换行
      </p>
    </div>
  </div>
</template>
