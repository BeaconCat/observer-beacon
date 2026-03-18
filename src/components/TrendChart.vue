<script setup lang="ts">
import { computed } from 'vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { DailyMetrics } from '../api';

use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const props = withDefaults(defineProps<{
  data: DailyMetrics[];
  title: string;
  keys: string[];
  colors: string[];
  labels: string[];
  dualAxis?: boolean;
}>(), { dualAxis: false });

const option = computed(() => {
  // Detect raw mode: if multiple records share the same date, show datetime
  const dates = props.data.map(d => d.date);
  const isRaw = new Set(dates).size < dates.length || props.data.some(d => d.fetched_at && dates.filter(dd => dd === d.date).length > 1);

  const xLabels = props.data.map(d => {
    if (isRaw && d.fetched_at) {
      // MM-DD HH:mm
      const dt = new Date(d.fetched_at);
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      const hh = String(dt.getHours()).padStart(2, '0');
      const mi = String(dt.getMinutes()).padStart(2, '0');
      return `${mm}-${dd} ${hh}:${mi}`;
    }
    return d.date.slice(5); // MM-DD
  });

  const yAxes: any[] = [{
    type: 'value',
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
    axisLabel: { color: '#555', fontSize: 10 },
  }];
  if (props.dualAxis) {
    yAxes.push({
      type: 'value',
      splitLine: { show: false },
      axisLabel: { color: '#555', fontSize: 10 },
    });
  }

  return {
    backgroundColor: 'transparent',
    title: { text: props.title, textStyle: { color: '#999', fontSize: 13, fontWeight: 500 }, left: 0, top: 0 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(10,10,15,0.95)',
      borderColor: 'rgba(255,255,255,0.1)',
      textStyle: { color: '#e0e0e0', fontSize: 11 },
    },
    legend: { data: props.labels, textStyle: { color: '#666', fontSize: 10 }, top: 0, right: 0 },
    grid: { left: 8, right: props.dualAxis ? 8 : 8, top: 36, bottom: 20, containLabel: true },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLine: { lineStyle: { color: '#222' } },
      axisLabel: { color: '#555', fontSize: 9, rotate: isRaw ? 35 : 0 },
    },
    yAxis: yAxes,
    series: props.keys.map((key, i) => ({
      name: props.labels[i],
      type: 'line',
      yAxisIndex: (props.dualAxis && i === props.keys.length - 1) ? 1 : 0,
      data: props.data.map(d => (d as any)[key]),
      smooth: true,
      symbol: 'circle',
      symbolSize: 3,
      lineStyle: { color: props.colors[i], width: 2 },
      itemStyle: { color: props.colors[i] },
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: props.colors[i] + '25' },
            { offset: 1, color: props.colors[i] + '03' },
          ],
        },
      },
    })),
  };
});
</script>

<template>
  <VChart :option="option" style="height:220px;width:100%" autoresize />
</template>
