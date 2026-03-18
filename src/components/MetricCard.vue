<script setup lang="ts">
import { Icon } from '@iconify/vue';

const props = withDefaults(defineProps<{
  label: string;
  value: number | string;
  icon: string;
  color: string;
  delta?: number;
  raw?: boolean;
}>(), { delta: 0, raw: false });
</script>

<template>
  <div class="mc" :style="{ '--accent': color }">
    <div class="mc-top">
      <Icon :icon="icon" width="18" :style="{ color }" />
      <span v-if="delta > 0" class="mc-delta up">+{{ delta }}</span>
      <span v-else-if="delta < 0" class="mc-delta down">{{ delta }}</span>
    </div>
    <div class="mc-value">{{ raw ? value : (typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(1) : value) }}</div>
    <div class="mc-label">{{ label }}</div>
    <div class="mc-glow" :style="{ background: color }"></div>
  </div>
</template>

<style scoped>
.mc {
  position: relative; background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.07);
  border-radius: 8px; padding: 14px; overflow: hidden; transition: border-color 0.2s;
}
.mc:hover { border-color: var(--accent); }
.mc-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.mc-delta { font-size: 11px; font-weight: 600; font-family: monospace; padding: 1px 5px; border-radius: 4px; }
.mc-delta.up { color: #22c55e; background: rgba(34,197,94,0.12); }
.mc-delta.down { color: #ef4444; background: rgba(239,68,68,0.12); }
.mc-value { font-size: 26px; font-weight: 700; color: #fff; font-family: 'Segoe UI', monospace; line-height: 1.1; }
.mc-label { font-size: 11px; color: #777; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.4px; }
.mc-glow { position: absolute; bottom: 0; left: 0; right: 0; height: 2px; opacity: 0.5; filter: blur(4px); }
</style>
