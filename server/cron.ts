import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fetchDailyMetrics, correctedNow } from './github.ts';
import { appendMetrics } from './db.ts';

const STATE_DIR = path.join(process.cwd(), 'data');
const stateFile = (name: string) => path.join(STATE_DIR, name);

function readState(name: string): string | null {
  const f = stateFile(name);
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, 'utf-8').trim() || null;
}
function writeState(name: string, val: string): void {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFile(name), val, 'utf-8');
}

let lastCronRun: string | null = readState('last_cron_run.txt');
let lastManualRun: string | null = readState('last_manual_run.txt');
let cronRunning = false;
let skipNextCron = false;

const INTERVAL_MIN = Math.max(1, parseInt(process.env.OBSERVER_INTERVAL || '30', 10));
const MANUAL_COOLDOWN_MIN = Math.max(1, parseInt(process.env.OBSERVER_MANUAL_INTERVAL || '5', 10));
const MANUAL_COOLDOWN_MS = MANUAL_COOLDOWN_MIN * 60 * 1000;
const SKIP_AFTER_MANUAL = (process.env.OBSERVER_SKIP_CRON_AFTER_MANUAL || 'true').toLowerCase() === 'true';

async function doFetch(source: string, retries = 0): Promise<void> {
  if (cronRunning) return;
  cronRunning = true;
  console.log(`[${source}] ${correctedNow().toISOString()} Starting fetch...${retries > 0 ? ` (retry ${retries})` : ''}`);
  try {
    const metrics = await fetchDailyMetrics();
    appendMetrics(metrics);
    const ts = correctedNow().toISOString();
    if (source === 'CRON') { lastCronRun = ts; writeState('last_cron_run.txt', ts); }
    else { lastManualRun = ts; writeState('last_manual_run.txt', ts); }
    console.log(`[${source}] Done. Date: ${metrics.date}`);
  } catch (e: any) {
    console.error(`[${source}] Error:`, e.message);
    cronRunning = false;
    // Auto-retry for CRON (max 2 retries, 5min apart). Manual throws to caller.
    if (source === 'CRON' && retries < 2) {
      const delay = 5 * 60 * 1000;
      console.log(`[${source}] Retrying in 5 minutes...`);
      setTimeout(() => doFetch(source, retries + 1), delay);
      return;
    }
    if (source === 'MANUAL') throw e;
  } finally {
    cronRunning = false;
  }
}

export function startCron(): void {
  // Build cron expression: always align to clock boundaries
  // e.g. 30 → "0,30 * * * *", 10 → "0,10,20,30,40,50 * * * *", 15 → "0,15,30,45 * * * *"
  if (INTERVAL_MIN >= 60) {
    const hours = Math.floor(INTERVAL_MIN / 60);
    cron.schedule(`0 */${hours} * * *`, () => cronTick());
  } else {
    const minutes: number[] = [];
    for (let m = 0; m < 60; m += INTERVAL_MIN) {
      minutes.push(m);
    }
    const expr = `${minutes.join(',')} * * * *`;
    cron.schedule(expr, () => cronTick());
    console.log(`[CRON] Schedule: minute ${minutes.join(', ')} of every hour`);
  }
  console.log(`[CRON] Auto-fetch every ${INTERVAL_MIN}min | Manual cooldown ${MANUAL_COOLDOWN_MIN}min | Skip after manual: ${SKIP_AFTER_MANUAL}`);
}

function cronTick(): void {
  if (SKIP_AFTER_MANUAL && skipNextCron) {
    console.log(`[CRON] Skipped (manual update was recent)`);
    skipNextCron = false;
    return;
  }
  doFetch('CRON');
}

export async function manualUpdate(): Promise<void> {
  if (lastManualRun) {
    const elapsed = correctedNow().getTime() - new Date(lastManualRun).getTime();
    console.log(`[MANUAL] Cooldown check: lastRun=${lastManualRun}, elapsed=${Math.round(elapsed/1000)}s, cooldown=${MANUAL_COOLDOWN_MS/1000}s`);
    // If elapsed is negative (clock skew / timezone change), ignore cooldown
    if (elapsed >= 0 && elapsed < MANUAL_COOLDOWN_MS) {
      const remaining = Math.ceil((MANUAL_COOLDOWN_MS - elapsed) / 60000);
      throw new Error(`Manual update on cooldown. Try again in ${remaining} min.`);
    }
  }
  await doFetch('MANUAL');
  if (SKIP_AFTER_MANUAL) skipNextCron = true;
}

export function getLastCronRun(): string | null { return lastCronRun; }
export function getLastManualRun(): string | null { return lastManualRun; }
export function isCronRunning(): boolean { return cronRunning; }
export function getIntervalMin(): number { return INTERVAL_MIN; }
export function getManualCooldownMin(): number { return MANUAL_COOLDOWN_MIN; }
