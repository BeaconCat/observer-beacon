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

export async function fetchConfig(): Promise<{ name: string; repo: string; accent: string }> {
  const res = await fetch('/api/config');
  return res.json();
}

export async function fetchMetrics(from?: string, to?: string, mode?: string): Promise<DailyMetrics[]> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (mode) params.set('mode', mode);
  const res = await fetch(`/api/metrics?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchLatest(): Promise<DailyMetrics | null> {
  const res = await fetch('/api/metrics/latest');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchStatus(): Promise<any> {
  const res = await fetch('/api/status');
  return res.json();
}

export async function verifyPassword(password: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return res.json();
}

export async function triggerUpdate(password: string): Promise<{ ok: boolean; error?: string; metrics?: DailyMetrics }> {
  const res = await fetch('/api/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return res.json();
}
