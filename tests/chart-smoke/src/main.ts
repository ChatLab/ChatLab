import { createApp, h } from 'vue'
import type { ChartPayload } from '@openchatlab/core'
import ChartBlockRenderer from '../../../src/components/AIChat/chat/ChartBlockRenderer.vue'
import './style.css'

const charts: ChartPayload[] = [
  {
    version: 1,
    spec: {
      version: 1,
      type: 'bar',
      title: 'Messages by member',
      encoding: { x: 'name', y: 'message_count' },
    },
    dataset: {
      columns: [
        { name: 'name', type: 'category' },
        { name: 'message_count', type: 'integer' },
      ],
      rows: [
        { name: 'Alice', message_count: 8 },
        { name: 'Bob', message_count: 5 },
        { name: 'Cara', message_count: 3 },
      ],
    },
    data: { labels: ['Alice', 'Bob', 'Cara'], values: [8, 5, 3] },
    rowCount: 3,
  },
  {
    version: 1,
    spec: {
      version: 1,
      type: 'line',
      title: 'Daily member trend',
      encoding: { x: 'day', y: 'message_count', series: 'member_name' },
    },
    dataset: {
      columns: [
        { name: 'day', type: 'date' },
        { name: 'member_name', type: 'category' },
        { name: 'message_count', type: 'integer' },
      ],
      rows: [
        { day: '2026-06-01', member_name: 'Alice', message_count: 3 },
        { day: '2026-06-02', member_name: 'Alice', message_count: 5 },
        { day: '2026-06-01', member_name: 'Bob', message_count: 2 },
        { day: '2026-06-02', member_name: 'Bob', message_count: 4 },
      ],
    },
    data: {
      labels: ['2026-06-01', '2026-06-02'],
      values: [3, 5],
      series: [
        { name: 'Alice', values: [3, 5] },
        { name: 'Bob', values: [2, 4] },
      ],
    },
    rowCount: 4,
  },
  {
    version: 1,
    spec: {
      version: 1,
      type: 'pie',
      title: 'Selected members',
      encoding: { label: 'name', value: 'message_count' },
    },
    dataset: {
      columns: [
        { name: 'name', type: 'category' },
        { name: 'message_count', type: 'integer' },
      ],
      rows: [
        { name: 'Alice', message_count: 8 },
        { name: 'Bob', message_count: 5 },
      ],
    },
    data: { labels: ['Alice', 'Bob'], values: [8, 5] },
    rowCount: 2,
  },
  {
    version: 1,
    spec: {
      version: 1,
      type: 'heatmap',
      title: 'Weekday hour density',
      encoding: { x: 'hour', y: 'weekday', value: 'message_count' },
    },
    dataset: {
      columns: [
        { name: 'hour', type: 'integer' },
        { name: 'weekday', type: 'category' },
        { name: 'message_count', type: 'integer' },
      ],
      rows: [
        { hour: '09', weekday: 'Mon', message_count: 3 },
        { hour: '10', weekday: 'Mon', message_count: 5 },
        { hour: '09', weekday: 'Tue', message_count: 2 },
      ],
    },
    data: {
      xLabels: ['09', '10'],
      yLabels: ['Mon', 'Tue'],
      data: [
        [0, 0, 3],
        [1, 0, 5],
        [0, 1, 2],
      ],
    },
    rowCount: 3,
  },
]

createApp({
  render() {
    return h(
      'main',
      { class: 'chart-smoke-shell' },
      charts.map((chart) => h(ChartBlockRenderer, { key: chart.spec.title, chart }))
    )
  },
}).mount('#app')
