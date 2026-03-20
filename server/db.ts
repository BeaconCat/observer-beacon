import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'metrics.xml');

export interface DailyMetrics {
  date: string;
  new_prs: number;
  merged_prs: number;
  closed_prs: number;
  avg_review_rounds: number;
  open_prs: number;
  pr_merge_rate: number;
  new_issues: number;
  closed_issues: number;
  open_issues: number;
  zero_reply_issues: number;
  avg_issue_close_hours: number;
  daily_comments: number;
  pr_review_comments: number;
  commit_comments: number;
  daily_commits: number;
  total_commits: number;
  new_participants: number;
  active_users: number;
  total_stars: number;
  total_forks: number;
  new_stars: number;
  new_forks: number;
  total_watchers: number;
  total_contributors: number;
  repo_size_kb: number;
  bug_issues: number;
  feature_issues: number;
  returning_users: number;
  first_time_contributors: number;
  fetched_at: string;
}

const FIELDS: (keyof DailyMetrics)[] = [
  'date','new_prs','merged_prs','closed_prs','avg_review_rounds','open_prs','pr_merge_rate',
  'new_issues','closed_issues','open_issues','zero_reply_issues','avg_issue_close_hours',
  'daily_comments','pr_review_comments','commit_comments','daily_commits','total_commits','new_participants','active_users',
  'total_stars','total_forks','new_stars','new_forks','total_watchers',
  'total_contributors','repo_size_kb',
  'bug_issues','feature_issues',
  'returning_users','first_time_contributors',
  'fetched_at',
];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '', format: true, indentBy: '  ' });

function ensureFile(): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, '<?xml version="1.0" encoding="UTF-8"?>\n<metrics>\n</metrics>\n', 'utf-8');
  }
}

function parseRow(d: any): DailyMetrics {
  const m: any = {};
  for (const f of FIELDS) {
    if (f === 'date' || f === 'fetched_at') m[f] = String(d[f] || '');
    else m[f] = Number(d[f] || 0);
  }
  return m as DailyMetrics;
}

function readAll(): DailyMetrics[] {
  ensureFile();
  const xml = fs.readFileSync(DB_PATH, 'utf-8');
  const parsed = parser.parse(xml);
  if (!parsed.metrics || !parsed.metrics.record) return [];
  const records = Array.isArray(parsed.metrics.record) ? parsed.metrics.record : [parsed.metrics.record];
  return records.map(parseRow).sort((a, b) => (a.fetched_at || '').localeCompare(b.fetched_at || ''));
}

function writeAll(metrics: DailyMetrics[]): void {
  ensureFile();
  const sorted = [...metrics].sort((a, b) => (a.fetched_at || '').localeCompare(b.fetched_at || ''));
  const obj = { '?xml': { version: '1.0', encoding: 'UTF-8' }, metrics: { record: sorted } };
  const xml = builder.build(obj);
  fs.writeFileSync(DB_PATH, xml, 'utf-8');
}

// Append a new record (every fetch = new row)
// Minimum 2-minute gap to prevent near-duplicate writes from rapid retries
const MIN_DEDUP_MS = 2 * 60 * 1000;

export function appendMetrics(m: DailyMetrics): void {
  const all = readAll();
  if (all.length > 0) {
    // Find the truly latest record by fetched_at
    let latestRecord = all[0];
    let latestTime = new Date(latestRecord.fetched_at || '1970-01-01').getTime();
    for (const r of all) {
      const t = new Date(r.fetched_at || '1970-01-01').getTime();
      if (t > latestTime) { latestRecord = r; latestTime = t; }
    }
    // Prevent near-duplicate writes (< 2 min apart)
    if (latestRecord.fetched_at && m.fetched_at) {
      const gap = new Date(m.fetched_at).getTime() - latestTime;
      if (gap >= 0 && gap < MIN_DEDUP_MS) {
        console.log(`[WRITE] Skipped — too close to last record (${Math.round(gap/1000)}s < ${MIN_DEDUP_MS/1000}s)`);
        return;
      }
    }
    // Validate: reject records with total_contributors=0 when it shouldn't be
    if (m.total_contributors === 0 && latestRecord.total_contributors > 0) {
      console.log(`[WRITE] Skipped — total_contributors=0 (likely 202 response)`);
      return;
    }
  }
  all.push(m);
  writeAll(all);
}

// Get all raw records in date range (from/to are local dates YYYY-MM-DD)
// Filter by fetched_at to avoid UTC date boundary issues
export function getRawMetrics(from?: string, to?: string): DailyMetrics[] {
  let all = readAll();
  if (from) {
    const fromStart = new Date(from + 'T00:00:00').toISOString();
    all = all.filter(d => (d.fetched_at || d.date) >= fromStart);
  }
  if (to) {
    const toEnd = new Date(to + 'T23:59:59').toISOString();
    all = all.filter(d => (d.fetched_at || d.date) <= toEnd);
  }
  return all.sort((a, b) => (a.fetched_at || '').localeCompare(b.fetched_at || ''));
}

// Get daily metrics: for each date, pick the last record of the day (most complete data)
export function getDailyMetrics(from?: string, to?: string): DailyMetrics[] {
  const raw = getRawMetrics(from, to);
  const byDate = new Map<string, DailyMetrics[]>();
  for (const r of raw) {
    const arr = byDate.get(r.date) || [];
    arr.push(r);
    byDate.set(r.date, arr);
  }
  const result: DailyMetrics[] = [];
  for (const [, records] of byDate) {
    // Pick the last record of the day (latest fetched_at)
    let best = records[0];
    let bestTime = new Date(best.fetched_at || '1970-01-01').getTime();
    for (const r of records) {
      const t = new Date(r.fetched_at || '1970-01-01').getTime();
      if (t > bestTime) { best = r; bestTime = t; }
    }
    result.push(best);
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

export function getLatest(): DailyMetrics | null {
  const all = readAll();
  if (all.length === 0) return null;
  return all.sort((a, b) => (b.fetched_at || '').localeCompare(a.fetched_at || ''))[0];
}

export function getAllUsers(): Set<string> {
  const usersPath = path.join(path.dirname(DB_PATH), 'known_users.txt');
  if (!fs.existsSync(usersPath)) return new Set();
  return new Set(fs.readFileSync(usersPath, 'utf-8').split('\n').filter(Boolean));
}

export function saveUsers(users: Set<string>): void {
  const usersPath = path.join(path.dirname(DB_PATH), 'known_users.txt');
  const dir = path.dirname(usersPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(usersPath, [...users].join('\n'), 'utf-8');
}

// Track today's new users separately so first-time only increases within a day
const todayNewUsersPath = () => path.join(path.dirname(DB_PATH), 'today_new_users.txt');
const todayDatePath = () => path.join(path.dirname(DB_PATH), 'today_date.txt');

export function getTodayNewUsers(date: string): Set<string> {
  const dp = todayDatePath();
  const up = todayNewUsersPath();
  // If date changed, reset today's new users
  if (fs.existsSync(dp) && fs.readFileSync(dp, 'utf-8').trim() !== date) {
    if (fs.existsSync(up)) fs.unlinkSync(up);
  }
  fs.writeFileSync(dp, date, 'utf-8');
  if (!fs.existsSync(up)) return new Set();
  return new Set(fs.readFileSync(up, 'utf-8').split('\n').filter(Boolean));
}

export function saveTodayNewUsers(users: Set<string>): void {
  fs.writeFileSync(todayNewUsersPath(), [...users].join('\n'), 'utf-8');
}
