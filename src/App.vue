<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { NConfigProvider, NLayout, NButton, NDatePicker, NInput, NModal, NSpace, NTag, NTooltip, NSwitch, NMessageProvider, useMessage, darkTheme } from 'naive-ui';
import { Icon } from '@iconify/vue';
import MetricCard from './components/MetricCard.vue';
import TrendChart from './components/TrendChart.vue';
import GaugeCard from './components/GaugeCard.vue';
import { fetchMetrics, fetchLatest, fetchStatus, fetchConfig, verifyPassword as apiVerify, triggerUpdate, type DailyMetrics } from './api';

const metrics = ref<DailyMetrics[]>([]);
const latest = ref<DailyMetrics | null>(null);
const status = ref<any>(null);
const config = ref<{ name: string; repo: string; accent: string }>({ name: '', repo: '', accent: '#00d4ff' });
const configLoaded = ref(false);
const dataLoaded = ref(false);
const loading = ref(false);
const updating = ref(false);
const showPwdModal = ref(false);
const password = ref(localStorage.getItem('obs_pwd') || '');
const pwdError = ref('');
const toastMsg = ref('');
const toastType = ref<'error' | 'success' | 'info'>('info');
const showToast = ref(false);
const dateRange = ref<[number, number] | null>(null);
const dailyMode = ref(false);

function toast(msg: string, type: 'error' | 'success' | 'info' = 'info') {
  toastMsg.value = msg; toastType.value = type; showToast.value = true;
  setTimeout(() => { showToast.value = false; }, 5000);
}

async function loadData() {
  loading.value = true;
  try { config.value = await fetchConfig(); configLoaded.value = true; } catch {}
  try { status.value = await fetchStatus(); } catch {}
  try {
    const mode = dailyMode.value ? 'daily' : 'raw';
    const defaultDays = mode === 'raw' ? 2 : 31;
    const toLocalDate = (ts: number) => {
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };
    const [from, to] = dateRange.value
      ? [toLocalDate(dateRange.value[0]), toLocalDate(dateRange.value[1])]
      : [toLocalDate(Date.now() - defaultDays * 86400000), toLocalDate(Date.now())];
    metrics.value = await fetchMetrics(from, to, mode);
    latest.value = await fetchLatest();
  } catch (e) { console.error(e); }
  finally { loading.value = false; dataLoaded.value = true; }
}

// Retry once after 3s if backend wasn't ready on first load
onMounted(async () => {
  await loadData();
  if (!configLoaded.value) {
    setTimeout(loadData, 3000);
  }
});

// Step 1: Verify password only (close modal, save to localStorage)
async function handleVerify() {
  if (!password.value) { pwdError.value = 'Enter password'; return; }
  pwdError.value = '';
  try {
    const res = await apiVerify(password.value);
    if (res.ok) {
      localStorage.setItem('obs_pwd', password.value);
      showPwdModal.value = false;
      // Immediately trigger update after successful verify
      doUpdate();
    } else {
      pwdError.value = res.error || 'Wrong password';
      if (res.error?.includes('Wrong')) {
        localStorage.removeItem('obs_pwd');
        password.value = '';
      }
    }
  } catch (e: any) { pwdError.value = e.message; }
}

// Step 2: Trigger update (password already verified & saved)
async function doUpdate() {
  if (!password.value) { showPwdModal.value = true; return; }
  updating.value = true;
  try {
    const res = await triggerUpdate(password.value);
    if (res.ok) {
      toast('Update complete', 'success');
      await loadData();
    } else if (res.error?.includes('Wrong') || res.error?.includes('password')) {
      // Password changed server-side
      localStorage.removeItem('obs_pwd');
      password.value = '';
      showPwdModal.value = true;
      pwdError.value = res.error || 'Password expired';
    } else {
      // Cooldown, rate limit, fetch error — toast only, keep password
      toast(res.error || 'Update failed', 'error');
    }
  } catch (e: any) { toast(e.message, 'error'); }
  finally { updating.value = false; }
}

function downloadExcel() {
  const [from, to] = dateRange.value ? [new Date(dateRange.value[0]).toISOString().slice(0, 10), new Date(dateRange.value[1]).toISOString().slice(0, 10)] : ['', ''];
  const mode = dailyMode.value ? 'daily' : 'raw';
  window.open(`/api/export/excel?from=${from}&to=${to}&mode=${mode}`);
}
function downloadCsv() {
  const [from, to] = dateRange.value ? [new Date(dateRange.value[0]).toISOString().slice(0, 10), new Date(dateRange.value[1]).toISOString().slice(0, 10)] : ['', ''];
  const mode = dailyMode.value ? 'daily' : 'raw';
  window.open(`/api/export/csv?from=${from}&to=${to}&mode=${mode}`);
}

// Compute delta vs previous day
function delta(key: keyof DailyMetrics): number {
  if (metrics.value.length < 2) return 0;
  const curr = (latest.value as any)?.[key] || 0;
  const prev = (metrics.value[metrics.value.length - 2] as any)?.[key] || 0;
  return curr - prev;
}

</script>

<template>
  <NConfigProvider :theme="darkTheme">
    <NLayout class="app-layout" :native-scrollbar="false">
      <!-- Header -->
      <div class="header">
        <div class="title-block">
          <div class="title-row">
            <Icon icon="carbon:dashboard" width="26" style="color:#eab308" />
            <template v-if="!configLoaded">
              <Icon icon="carbon:rotate-360" width="20" class="spin" style="color:#666" />
            </template>
            <template v-else>
              <a :href="'https://github.com/' + config.repo" target="_blank" rel="noopener"
                class="title-link anim-in" :style="{ '--glow': config.accent }">
                <h1 class="title">{{ config.name }}</h1>
              </a>
              <span class="title-suffix anim-in d1">Observer</span>
            </template>
          </div>
          <div class="date-label" v-if="latest">
            <span class="date-line">{{ latest.date }} | Fetched {{ latest.fetched_at?.slice(11, 16) }} UTC</span>
            <span class="date-sep">|</span>
            <span class="date-line"><span v-if="status?.lastManualRun">Manual {{ status.lastManualRun.slice(11,16) }}</span>
            <span v-if="status?.intervalMin"> | Auto Every {{ status.intervalMin }}min</span></span>
          </div>
        </div>
        <div class="controls">
          <div class="date-row">
            <NDatePicker v-model:value="dateRange" type="daterange" clearable size="small"
              style="width:280px;max-width:100%" @update:value="loadData" />
          </div>
          <div class="btn-row">
            <div class="mode-switch">
              <span class="mode-label" :class="{ active: !dailyMode }">Raw</span>
              <NSwitch v-model:value="dailyMode" size="small" @update:value="loadData">
                <template #checked><Icon icon="carbon:calendar" width="12" /></template>
                <template #unchecked><Icon icon="carbon:list" width="12" /></template>
              </NSwitch>
              <span class="mode-label" :class="{ active: dailyMode }">Daily</span>
            </div>
            <NButton size="small" @click="downloadExcel" quaternary>
              <template #icon><Icon icon="carbon:document" /></template>Excel
            </NButton>
            <NButton size="small" @click="downloadCsv" quaternary>
              <template #icon><Icon icon="carbon:table-split" /></template>CSV
            </NButton>
            <NButton type="warning" size="small" @click="password ? doUpdate() : showPwdModal = true" :loading="updating">
              <template #icon><Icon icon="carbon:renew" /></template>Update
            </NButton>
          </div>
        </div>
      </div>

      <!-- Toast -->
      <Transition name="toast">
        <div v-if="showToast" class="toast" :class="toastType">
          <Icon :icon="toastType === 'error' ? 'carbon:warning' : toastType === 'success' ? 'carbon:checkmark' : 'carbon:information'" width="16" />
          {{ toastMsg }}
        </div>
      </Transition>

      <!-- Data loading state -->
      <div v-if="!dataLoaded" class="loading-center">
        <Icon icon="carbon:rotate-360" width="32" class="spin" style="color:#555" />
        <span class="loading-text">Fetching data...</span>
      </div>

      <template v-else>
      <!-- ===== SECTION 1: Growth (Acquisition) ===== -->
      <div class="section-title anim-up d0">
        <Icon icon="carbon:growth" width="18" style="color:#eab308" />
        <span>Growth & Acquisition</span>
      </div>
      <div class="card-grid-5 anim-up d1">
        <MetricCard label="Total Stars" :value="latest?.total_stars ?? 0" icon="carbon:star" color="#eab308" :delta="delta('total_stars')" />
        <MetricCard label="Total Forks" :value="latest?.total_forks ?? 0" icon="carbon:fork" color="#3b82f6" :delta="delta('total_forks')" />
        <MetricCard label="Watchers" :value="latest?.total_watchers ?? 0" icon="carbon:view" color="#8b5cf6" :delta="delta('total_watchers')" />
        <MetricCard label="Contributors" :value="latest?.total_contributors ?? 0" icon="carbon:group" color="#22c55e" :delta="delta('total_contributors')" />
        <MetricCard label="Repo Size" :value="latest?.repo_size_kb ? Math.round(latest.repo_size_kb / 1024) + ' MB' : '—'" icon="carbon:data-base" color="#888" :raw="true" />
      </div>
      <div class="card-grid-4 anim-up d2">
        <MetricCard label="Committers Today" :value="latest?.new_participants ?? 0" icon="carbon:code" color="#eab308" />
        <MetricCard label="First-Time Committers" :value="latest?.first_time_contributors ?? 0" icon="carbon:user-avatar-filled" color="#22c55e" />
        <MetricCard label="Returning Committers" :value="latest?.returning_users ?? 0" icon="carbon:repeat" color="#3b82f6" />
        <MetricCard label="Active Users (all)" :value="latest?.active_users ?? 0" icon="carbon:activity" color="#f97316" />
      </div>
      <div class="chart-row anim-up d3">
        <div class="chart-box">
          <TrendChart :data="metrics" title="Stars & Forks Growth" :keys="['total_stars','total_forks']"
            :colors="['#eab308','#3b82f6']" :labels="['Stars','Forks']" />
        </div>
        <div class="chart-box">
          <TrendChart :data="metrics" title="Committers & Retention" :keys="['new_participants','first_time_contributors','returning_users']"
            :colors="['#eab308','#22c55e','#3b82f6']" :labels="['Committers','First-Time','Returning']" />
        </div>
      </div>

      <!-- ===== SECTION 2: PR Health ===== -->
      <div class="section-title anim-up d4">
        <Icon icon="carbon:branch" width="18" style="color:#3b82f6" />
        <span>Pull Request Health</span>
      </div>
      <div class="card-grid-5 anim-up d5">
        <MetricCard label="New PRs" :value="latest?.new_prs ?? 0" icon="carbon:add-alt" color="#3b82f6" />
        <MetricCard label="Merged" :value="latest?.merged_prs ?? 0" icon="carbon:checkmark-filled" color="#22c55e" />
        <MetricCard label="Closed (unmerged)" :value="latest?.closed_prs ?? 0" icon="carbon:close-outline" color="#ef4444" />
        <MetricCard label="Open PRs" :value="latest?.open_prs ?? 0" icon="carbon:in-progress" color="#f97316" :delta="delta('open_prs')" />
        <MetricCard label="Avg Reviews" :value="latest?.avg_review_rounds ?? 0" icon="carbon:catalog" color="#eab308" />
      </div>
      <div class="chart-row anim-up d6">
        <div class="chart-box">
          <TrendChart :data="metrics" title="PR Flow (New / Merged / Closed)" :keys="['new_prs','merged_prs','closed_prs']"
            :colors="['#3b82f6','#22c55e','#ef4444']" :labels="['New','Merged','Closed']" />
        </div>
        <div class="chart-box">
          <TrendChart :data="metrics" title="Open PRs & Merge Rate" :keys="['open_prs','pr_merge_rate']"
            :colors="['#f97316','#22c55e']" :labels="['Open PRs','Merge Rate %']" :dualAxis="true" />
        </div>
      </div>

      <!-- ===== SECTION 3: Issue Health ===== -->
      <div class="section-title anim-up d7">
        <Icon icon="carbon:task" width="18" style="color:#ef4444" />
        <span>Issue Health</span>
      </div>
      <div class="card-grid-5 anim-up d8">
        <MetricCard label="New Issues" :value="latest?.new_issues ?? 0" icon="carbon:warning-alt" color="#ef4444" />
        <MetricCard label="Closed" :value="latest?.closed_issues ?? 0" icon="carbon:checkmark" color="#22c55e" />
        <MetricCard label="Open Issues" :value="latest?.open_issues ?? 0" icon="carbon:pending" color="#f97316" :delta="delta('open_issues')" />
        <MetricCard label="Zero-Reply" :value="latest?.zero_reply_issues ?? 0" icon="carbon:chat-off" color="#ef4444" :delta="delta('zero_reply_issues')" />
        <MetricCard label="Avg Close (hrs)" :value="latest?.avg_issue_close_hours ?? 0" icon="carbon:time" color="#eab308" />
      </div>
      <div class="card-grid-3 anim-up d9" style="margin-bottom:16px">
        <GaugeCard label="Bug Issues" :value="latest?.bug_issues ?? 0" :total="latest?.open_issues ?? 1" color="#ef4444" icon="carbon:debug" />
        <GaugeCard label="Feature Requests" :value="latest?.feature_issues ?? 0" :total="latest?.open_issues ?? 1" color="#3b82f6" icon="carbon:idea" />
        <GaugeCard label="Unlabeled" :value="Math.max(0, (latest?.open_issues ?? 0) - (latest?.bug_issues ?? 0) - (latest?.feature_issues ?? 0))" :total="latest?.open_issues ?? 1" color="#888" icon="carbon:tag" />
      </div>
      <div class="chart-row anim-up d10">
        <div class="chart-box">
          <TrendChart :data="metrics" title="Issue Flow (New / Closed)" :keys="['new_issues','closed_issues']"
            :colors="['#ef4444','#22c55e']" :labels="['New','Closed']" />
        </div>
        <div class="chart-box">
          <TrendChart :data="metrics" title="Zero-Reply & Avg Close Time" :keys="['zero_reply_issues','avg_issue_close_hours']"
            :colors="['#ef4444','#eab308']" :labels="['Zero-Reply','Avg Close Hrs']" :dualAxis="true" />
        </div>
      </div>

      <!-- ===== SECTION 4: Community Activity ===== -->
      <div class="section-title anim-up d11">
        <Icon icon="carbon:chat" width="18" style="color:#8b5cf6" />
        <span>Community Activity</span>
      </div>
      <div class="card-grid-4 anim-up d12">
        <MetricCard label="Daily Commits" :value="latest?.daily_commits ?? 0" icon="carbon:commit" color="#22c55e" />
        <MetricCard label="Total Commits" :value="latest?.total_commits ?? 0" icon="carbon:version" color="#22c55e" />
        <MetricCard label="Total Comments" :value="latest?.daily_comments ?? 0" icon="carbon:chat" color="#8b5cf6" />
        <MetricCard label="PR Reviews" :value="latest?.pr_review_comments ?? 0" icon="carbon:document-preliminary" color="#3b82f6" />
      </div>
      <div class="chart-row anim-up d13">
        <div class="chart-box">
          <TrendChart :data="metrics" title="Commits & Comments" :keys="['daily_commits','daily_comments','pr_review_comments']"
            :colors="['#22c55e','#8b5cf6','#3b82f6']" :labels="['Commits','Comments','PR Reviews']" />
        </div>
        <div class="chart-box">
          <TrendChart :data="metrics" title="Total Commits Growth" :keys="['total_commits']"
            :colors="['#22c55e']" :labels="['Total Commits']" />
        </div>
      </div>

      <!-- Footer -->
      <div class="footer anim-up d14">
        <span>Built by <a href="https://github.com/BeaconCat" target="_blank" rel="noopener" class="footer-link">BeaconCat</a></span>
        <span class="footer-sep">|</span>
        <a href="https://github.com/BeaconCat/observer-beacon" target="_blank" rel="noopener" class="footer-link">Observer Beacon v1.0</a>
      </div>
      </template>

      <!-- Password Modal -->
      <NModal v-model:show="showPwdModal" preset="card" title="Authentication Required" style="width:400px;max-width:90vw"
        :mask-closable="false" :bordered="false">
        <NSpace vertical>
          <NInput v-model:value="password" type="password" placeholder="Enter password"
            show-password-on="click" :input-props="{ style: 'font-family: Consolas, monospace' }"
            @keyup.enter="handleVerify" :status="pwdError ? 'error' : undefined" />
          <div v-if="pwdError" style="color:#ef4444;font-size:13px">{{ pwdError }}</div>
          <NButton type="warning" block @click="handleVerify">
            <template #icon><Icon icon="carbon:locked" /></template>Verify
          </NButton>
        </NSpace>
      </NModal>
    </NLayout>
  </NConfigProvider>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
.app-layout { min-height: 100vh; background: #0a0a0f; padding: 20px 24px; }

/* NLayout scroll container: disable its own scroll, let body handle it */
.n-layout-scroll-container {
  overflow: visible !important;
  scrollbar-width: none !important;
}
.n-layout-scroll-container::-webkit-scrollbar { display: none !important; }
/* NLayout itself should not create a scroll context */
.n-layout { overflow: visible !important; }

/* Global custom scrollbar (for body/html) */
html, body { scrollbar-width: thin; scrollbar-color: #333 transparent; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #444; }

/* Toast */
.toast { position: fixed; top: 16px; right: 16px; z-index: 9999; display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 6px; font-size: 13px; backdrop-filter: blur(8px); }
.toast.error { background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); color: #ef4444; }
.toast.success { background: rgba(34,197,94,0.15); border: 1px solid rgba(34,197,94,0.3); color: #22c55e; }
.toast.info { background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.3); color: #3b82f6; }
.toast-enter-active { transition: all 0.3s ease; }
.toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from { opacity: 0; transform: translateX(20px); }
.toast-leave-to { opacity: 0; transform: translateX(20px); }

/* Spinner */
.spin { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* Title anim-in: slide from left with stagger */
.anim-in { animation: slideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
.anim-in.d1 { animation-delay: 0.08s; }
.anim-in.d2 { animation-delay: 0.16s; }
@keyframes slideIn { from { opacity: 0; transform: translateX(-16px); } to { opacity: 1; transform: translateX(0); } }

/* Section anim-up: fade up with stagger */
.anim-up { animation: fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
.d0 { animation-delay: 0s; } .d1 { animation-delay: 0.04s; } .d2 { animation-delay: 0.08s; }
.d3 { animation-delay: 0.12s; } .d4 { animation-delay: 0.16s; } .d5 { animation-delay: 0.2s; }
.d6 { animation-delay: 0.24s; } .d7 { animation-delay: 0.28s; } .d8 { animation-delay: 0.32s; }
.d9 { animation-delay: 0.36s; } .d10 { animation-delay: 0.4s; } .d11 { animation-delay: 0.44s; }
.d12 { animation-delay: 0.48s; } .d13 { animation-delay: 0.52s; } .d14 { animation-delay: 0.56s; }
@keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

/* Loading center */
.loading-center { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 80px 0; }
.loading-text { font-size: 13px; color: #555; }

/* Header */
.header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
.title-block { display: flex; flex-direction: column; gap: 4px; }
.title-row { display: flex; align-items: center; gap: 10px; overflow: visible; }
.title-link { text-decoration: none; transition: all 0.3s ease; border-radius: 4px; padding: 2px 8px; margin: -2px -8px; overflow: visible; }
.title-link:hover { text-shadow: 0 0 6px var(--glow), 0 0 14px var(--glow); }
.title-link:hover .title { color: var(--glow); }
.title { font-size: 20px; font-weight: 700; color: #fff; letter-spacing: 1px; transition: color 0.3s; }
.title-suffix { font-size: 20px; font-weight: 400; color: #555; letter-spacing: 1px; }
.controls { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.date-row { display: flex; gap: 8px; }
.btn-row { display: flex; gap: 6px; }
.date-label { font-size: 11px; color: #555; font-family: monospace; display: flex; flex-wrap: wrap; gap: 0 4px; align-items: center; }
.date-line { white-space: nowrap; }
.date-sep { color: #333; }
@media (max-width: 500px) {
  .date-sep { display: none; }
  .date-label { justify-content: center; }
  .date-line { width: 100%; text-align: center; }
}

/* Section titles */
.section-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: #ccc; margin: 20px 0 12px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.06); }

/* Card grids */
.card-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
.card-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px; }
.card-grid-5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 12px; }

/* Chart rows */
.chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.chart-box { background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 14px; min-width: 0; overflow: hidden; }
.chart-box.full { grid-column: 1 / -1; }

/* Mode switch */
.mode-switch { display: flex; align-items: center; gap: 6px; margin-right: 4px; }
.mode-label { font-size: 11px; color: #555; transition: color 0.2s; }
.mode-label.active { color: #eab308; font-weight: 600; }

/* Footer */
.footer { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 24px 0 8px; font-size: 12px; color: #444; }
.footer-sep { color: #333; }
.footer-link { color: #666; text-decoration: none; transition: color 0.2s; }
.footer-link:hover { color: #eab308; }

/* Mobile */
@media (max-width: 768px) {
  .app-layout { padding: 12px; }
  .header { flex-direction: column; align-items: center; }
  .title-block { align-items: center; }
  .title-row { justify-content: center; }
  .controls { align-items: center; width: 100%; }
  .date-row { width: 100%; justify-content: center; }
  .btn-row { width: 100%; justify-content: center; }
  .date-label { text-align: center; }
  .card-grid-3, .card-grid-4, .card-grid-5 { grid-template-columns: repeat(2, 1fr); }
  .card-grid-3 > :last-child:nth-child(odd),
  .card-grid-4 > :last-child:nth-child(odd),
  .card-grid-5 > :last-child:nth-child(odd) { grid-column: 1 / -1; }
  .chart-row { grid-template-columns: 1fr; }
}
@media (max-width: 360px) {
  .card-grid-3, .card-grid-4, .card-grid-5 { grid-template-columns: 1fr; }
  .card-grid-3 > :last-child:nth-child(odd),
  .card-grid-4 > :last-child:nth-child(odd),
  .card-grid-5 > :last-child:nth-child(odd) { grid-column: auto; }
}
</style>
