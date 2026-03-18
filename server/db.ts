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
  return records.map(parseRow);
}

function writeAll(metrics: DailyMetrics[]): void {
  ensureFile();
  const sorted = [...metrics].sort((a, b) => (a.fetched_at || '').localeCompare(b.fetched_at || ''));
  const obj = { '?xml': { version: '1.0', encoding: 'UTF-8' }, metrics: { record: sorted } };
  const xml = builder.build(obj);
  fs.writeFileSync(DB_PATH, xml, 'utf-8');
}

// Append a new record (every fetch = new row)
export function appendMetrics(m: DailyMetrics): void {
  const all = readAll();
  all.push(m);
  writeAll(all);
}

// Get all raw records in date range
export function getRawMetrics(from?: string, to?: string): DailyMetrics[] {
  let all = readAll();
  if (from) all = all.filter(d => d.date >= from);
  if (to) all = all.filter(d => d.date <= to);
  return all.sort((a, b) => (a.fetched_at || '').localeCompare(b.fetched_at || ''));
}

// Get daily metrics: for each date, pick the record closest to midnight (00:00)
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
    // Pick the one closest to 00:00 of that day
    let best = records[0];
    let bestDist = Infinity;
    for (const r of records) {
      if (!r.fetched_at) continue;
      const fetchTime = new Date(r.fetched_at);
      const midnight = new Date(r.date + 'T00:00:00Z');
      // Distance to midnight (could be same day or next day's 00:00)
      const nextMidnight = new Date(midnight.getTime() + 86400000);
      const dist = Math.min(
        Math.abs(fetchTime.getTime() - midnight.getTime()),
        Math.abs(fetchTime.getTime() - nextMidnight.getTime()),
      );
      if (dist < bestDist) { best = r; bestDist = dist; }
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
