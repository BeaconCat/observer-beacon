<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';

const props = defineProps<{
  label: string;
  value: number;
  total: number;
  color: string;
  icon: string;
}>();

const pct = computed(() => props.total > 0 ? Math.round((props.value / props.total) * 100) : 0);
</script>

<template>
  <div class="gc" :style="{ '--c': color }">
    <div class="gc-head">
      <Icon :icon="icon" width="16" :style="{ color }" />
      <span class="gc-label">{{ label }}</span>
      <span class="gc-num">{{ value }}</span>
    </div>
    <div class="gc-bar-bg">
      <div class="gc-bar" :style="{ width: pct + '%', background: color }"></div>
    </div>
    <div class="gc-pct">{{ pct }}% of open issues</div>
  </div>
</template>

<style scoped>
.gc { background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 14px; }
.gc-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.gc-label { font-size: 13px; color: #ccc; flex: 1; }
.gc-num { font-size: 20px; font-weight: 700; color: #fff; font-family: monospace; }
.gc-bar-bg { height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
.gc-bar { height: 100%; border-radius: 3px; transition: width 0.6s ease; box-shadow: 0 0 8px var(--c); }
.gc-pct { font-size: 10px; color: #555; margin-top: 4px; }
</style>
