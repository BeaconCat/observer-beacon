import cron from 'node-cron';
import { fetchDailyMetrics } from './github.ts';
import { appendMetrics } from './db.ts';

let lastCronRun: string | null = null;
let lastManualRun: string | null = null;
let cronRunning = false;

const INTERVAL_MIN = Math.max(1, parseInt(process.env.OBSERVER_INTERVAL || '30', 10));
const COOLDOWN_MS = INTERVAL_MIN * 60 * 1000;

async function doFetch(source: string): Promise<void> {
  if (cronRunning) return;
  cronRunning = true;
  console.log(`[${source}] ${new Date().toISOString()} Starting fetch...`);
  try {
    const metrics = await fetchDailyMetrics();
    appendMetrics(metrics);
    const now = new Date().toISOString();
    if (source === 'CRON') lastCronRun = now;
    else lastManualRun = now;
    console.log(`[${source}] Done. Date: ${metrics.date}`);
  } catch (e: any) {
    console.error(`[${source}] Error:`, e.message);
    throw e;
  } finally {
    cronRunning = false;
  }
}

export function startCron(): void {
  // Build cron expression from interval
  if (INTERVAL_MIN >= 60) {
    // Hourly or more: run at minute 0 every N hours
    const hours = Math.floor(INTERVAL_MIN / 60);
    cron.schedule(`0 */${hours} * * *`, () => doFetch('CRON'));
  } else {
    // Sub-hourly: run every N minutes
    cron.schedule(`*/${INTERVAL_MIN} * * * *`, () => doFetch('CRON'));
  }
  console.log(`[CRON] Scheduled fetch every ${INTERVAL_MIN} minutes`);
}

export async function manualUpdate(): Promise<void> {
  if (lastManualRun) {
    const elapsed = Date.now() - new Date(lastManualRun).getTime();
    if (elapsed < COOLDOWN_MS) {
      const remaining = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
      throw new Error(`Manual update on cooldown. Try again in ${remaining} minutes.`);
    }
  }
  await doFetch('MANUAL');
}

export function getLastCronRun(): string | null { return lastCronRun; }
export function getLastManualRun(): string | null { return lastManualRun; }
export function isCronRunning(): boolean { return cronRunning; }
export function getIntervalMin(): number { return INTERVAL_MIN; }
