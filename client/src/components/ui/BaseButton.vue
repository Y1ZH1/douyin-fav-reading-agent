<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/lib/utils';

const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
  }>(),
  { variant: 'primary', size: 'md', disabled: false },
);

const variantClasses = computed(() => ({
  primary:
    'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
  secondary:
    'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border',
  ghost: 'text-muted-foreground hover:text-foreground hover:bg-secondary',
  destructive:
    'bg-destructive text-destructive-foreground hover:bg-destructive/90',
}));

const sizeClasses = computed(() => ({
  sm: 'h-8 px-3 text-xs rounded-md',
  md: 'h-9 px-4 text-sm rounded-md',
  lg: 'h-10 px-6 text-sm rounded-lg',
}));
</script>

<template>
  <button
    :disabled="disabled"
    :class="
      cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        variantClasses[props.variant],
        sizeClasses[props.size],
      )
    "
  >
    <slot />
  </button>
</template>
