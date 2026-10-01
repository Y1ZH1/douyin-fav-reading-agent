<script setup lang="ts">
import type { DiffLine as DiffLineType } from '@/types/diff'
import DiffLineContent from './DiffLineContent.vue'

defineProps<{ line: DiffLineType }>()
</script>

<template>
  <DiffLineContent :line="line" />
</template>
