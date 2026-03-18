import ExcelJS from 'exceljs';
import type { DailyMetrics } from './db.ts';

const COLUMNS = [
  { key: 'date', header: 'Date' },
  { key: 'new_prs', header: 'New PRs' },
  { key: 'merged_prs', header: 'Merged PRs' },
  { key: 'closed_prs', header: 'Closed PRs' },
  { key: 'avg_review_rounds', header: 'Avg Review Rounds' },
  { key: 'open_prs', header: 'Open PRs' },
  { key: 'pr_merge_rate', header: 'PR Merge Rate %' },
  { key: 'new_issues', header: 'New Issues' },
  { key: 'closed_issues', header: 'Closed Issues' },
  { key: 'open_issues', header: 'Open Issues' },
  { key: 'zero_reply_issues', header: 'Zero-Reply Issues' },
  { key: 'avg_issue_close_hours', header: 'Avg Close Hours' },
  { key: 'daily_comments', header: 'Total Comments' },
  { key: 'pr_review_comments', header: 'PR Review Comments' },
  { key: 'commit_comments', header: 'Commit Comments' },
  { key: 'daily_commits', header: 'Daily Commits' },
  { key: 'total_commits', header: 'Total Commits' },
  { key: 'new_participants', header: 'New Participants' },
  { key: 'active_users', header: 'Active Users' },
  { key: 'returning_users', header: 'Returning Users' },
  { key: 'first_time_contributors', header: 'First-Time Contributors' },
  { key: 'total_stars', header: 'Total Stars' },
  { key: 'total_forks', header: 'Total Forks' },
  { key: 'new_stars', header: 'New Stars' },
  { key: 'new_forks', header: 'New Forks' },
  { key: 'total_watchers', header: 'Watchers' },
  { key: 'total_contributors', header: 'Contributors' },
  { key: 'repo_size_kb', header: 'Repo Size KB' },
  { key: 'bug_issues', header: 'Bug Issues' },
  { key: 'feature_issues', header: 'Feature Issues' },
  { key: 'fetched_at', header: 'Fetched At' },
];

export async function toExcel(data: DailyMetrics[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PicoClaw Observer';
  const ws = wb.addWorksheet('Metrics');
  ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.key === 'date' ? 14 : c.key === 'fetched_at' ? 24 : 18 }));
  data.forEach(row => ws.addRow(row));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function toCsv(data: DailyMetrics[]): string {
  const header = COLUMNS.map(c => c.header).join(',');
  const rows = data.map(d => COLUMNS.map(c => {
    const v = (d as any)[c.key];
    return typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v ?? '');
  }).join(','));
  return [header, ...rows].join('\n');
}
