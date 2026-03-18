import type { DailyMetrics } from './db.ts';
import { getAllUsers, saveUsers, getLatest } from './db.ts';

const REPO = (process.env.OBSERVER_REPO || 'BeaconCat/observer-beacon').trim();
const API = 'https://api.github.com';

function isValidToken(t: string | undefined): t is string {
  if (!t) return false;
  return t.startsWith('ghp_') || t.startsWith('gho_') || t.startsWith('github_pat_');
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'Beacon-Observer/1.0' };
  const token = process.env.GITHUB_TOKEN;
  if (isValidToken(token)) {
    h['Authorization'] = token.startsWith('ghp_') || token.startsWith('gho_') ? `token ${token}` : `Bearer ${token}`;
  }
  return h;
}

export function getTokenStatus(): 'authenticated' | 'anonymous' {
  return isValidToken(process.env.GITHUB_TOKEN) ? 'authenticated' : 'anonymous';
}

async function ghFetch(url: string): Promise<any> {
  const res = await fetch(url, { headers: headers() });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const resetIn = reset ? Math.ceil((Number(reset) * 1000 - Date.now()) / 60000) : '?';
    throw new Error(`GitHub API rate limit exceeded. Resets in ~${resetIn} min.`);
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
  return res.json();
}

// Search API: 1 request = 1 count, much more efficient than paginating
async function searchCount(query: string): Promise<number> {
  const res = await ghFetch(`${API}/search/issues?q=${encodeURIComponent(query)}&per_page=1`);
  return res.total_count || 0;
}

function todayStr(): string { return new Date().toISOString().slice(0, 10); }

export async function fetchDailyMetrics(date?: string): Promise<DailyMetrics> {
  const d = date || todayStr();

  // 1. Repo stats (1 request)
  const repo = await ghFetch(`${API}/repos/${REPO}`);

  // 2. Use Search API for counts (1 request each, ~10 total)
  const [newPrs, mergedPrs, closedPrsUnmerged, openPrs] = await Promise.all([
    searchCount(`repo:${REPO} type:pr created:${d}`),
    searchCount(`repo:${REPO} type:pr merged:${d}`),
    searchCount(`repo:${REPO} type:pr closed:${d} is:unmerged`),
    searchCount(`repo:${REPO} type:pr state:open`),
  ]);

  const [newIssues, closedIssues, openIssues, zeroReply] = await Promise.all([
    searchCount(`repo:${REPO} type:issue created:${d}`),
    searchCount(`repo:${REPO} type:issue closed:${d}`),
    searchCount(`repo:${REPO} type:issue state:open`),
    searchCount(`repo:${REPO} type:issue state:open comments:0`),
  ]);

  const [bugIssues, featureIssues] = await Promise.all([
    searchCount(`repo:${REPO} type:issue state:open label:"type: bug"`),
    searchCount(`repo:${REPO} type:issue state:open label:"type: enhancement"`),
  ]);

  // PR merge rate
  const totalResolved = mergedPrs + closedPrsUnmerged;
  const prMergeRate = totalResolved > 0 ? Math.round((mergedPrs / totalResolved) * 100) : 0;

  // 3. Commits today (1 request) + participation stats (1 request)
  let dailyCommits = 0;
  let totalCommits = 0;
  try {
    const commits = await ghFetch(`${API}/repos/${REPO}/commits?since=${d}T00:00:00Z&until=${d}T23:59:59Z&per_page=1`);
    // For count, we need to check pagination. Use a simpler approach:
    const commitsPage = await ghFetch(`${API}/repos/${REPO}/commits?since=${d}T00:00:00Z&until=${d}T23:59:59Z&per_page=100`);
    dailyCommits = Array.isArray(commitsPage) ? commitsPage.length : 0;
  } catch { /* skip */ }
  try {
    const participation = await ghFetch(`${API}/repos/${REPO}/stats/participation`);
    if (participation?.all) {
      totalCommits = (participation.all as number[]).reduce((a: number, b: number) => a + b, 0);
    }
  } catch { /* skip */ }

  // 4. Comments today (1 request)
  let dailyComments = 0;
  let prReviewComments = 0;
  try {
    const comments = await ghFetch(`${API}/repos/${REPO}/issues/comments?since=${d}T00:00:00Z&sort=created&direction=desc&per_page=100`);
    dailyComments = Array.isArray(comments) ? comments.filter((c: any) => c.created_at?.startsWith(d)).length : 0;
  } catch { /* skip */ }
  try {
    const prComments = await ghFetch(`${API}/repos/${REPO}/pulls/comments?since=${d}T00:00:00Z&sort=created&direction=desc&per_page=100`);
    prReviewComments = Array.isArray(prComments) ? prComments.filter((c: any) => c.created_at?.startsWith(d)).length : 0;
  } catch { /* skip */ }

  // 5. Avg review rounds (sample up to 5 recent merged PRs, 1+5 requests)
  let avgReviewRounds = 0;
  if (mergedPrs > 0) {
    try {
      const recentMerged = await ghFetch(`${API}/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=5`);
      const merged = Array.isArray(recentMerged) ? recentMerged.filter((p: any) => p.merged_at?.startsWith(d)).slice(0, 5) : [];
      if (merged.length > 0) {
        let totalRounds = 0;
        for (const pr of merged) {
          try {
            const reviews = await ghFetch(`${API}/repos/${REPO}/pulls/${pr.number}/reviews`);
            totalRounds += Array.isArray(reviews) ? reviews.length : 0;
          } catch { /* skip */ }
        }
        avgReviewRounds = Math.round((totalRounds / merged.length) * 10) / 10;
      }
    } catch { /* skip */ }
  }

  // 6. Avg issue close time (sample closed issues today, 1 request already done via search)
  let avgCloseHours = 0;
  if (closedIssues > 0) {
    try {
      const closedList = await ghFetch(`${API}/repos/${REPO}/issues?state=closed&sort=updated&direction=desc&per_page=10`);
      const todayClosed = Array.isArray(closedList) ? closedList.filter((i: any) => !i.pull_request && i.closed_at?.startsWith(d)) : [];
      if (todayClosed.length > 0) {
        const totalHours = todayClosed.reduce((sum: number, i: any) => {
          return sum + (new Date(i.closed_at).getTime() - new Date(i.created_at).getTime()) / 3600000;
        }, 0);
        avgCloseHours = Math.round((totalHours / todayClosed.length) * 10) / 10;
      }
    } catch { /* skip */ }
  }

  // 7. Active users from comments + PRs + issues (reuse already fetched data)
  const todayUsers = new Set<string>();
  try {
    const recentActivity = await ghFetch(`${API}/repos/${REPO}/issues/comments?since=${d}T00:00:00Z&sort=created&per_page=100`);
    if (Array.isArray(recentActivity)) {
      recentActivity.filter((c: any) => c.created_at?.startsWith(d)).forEach((c: any) => {
        if (c.user?.login) todayUsers.add(c.user.login);
      });
    }
  } catch { /* skip */ }
  // Also count PR/issue creators from search (but search doesn't return user details easily)
  // We'll use the comment users as a proxy for active users

  const knownUsers = getAllUsers();
  const firstTimeContributors = [...todayUsers].filter(u => !knownUsers.has(u)).length;
  const returningUsers = [...todayUsers].filter(u => knownUsers.has(u)).length;
  todayUsers.forEach(u => knownUsers.add(u));
  saveUsers(knownUsers);

  // 8. Contributors (1 request)
  let totalContributors = 0;
  try {
    // Use per_page=1 and check the Link header for total, or just get first page
    const contribs = await ghFetch(`${API}/repos/${REPO}/contributors?per_page=1&anon=false`);
    // GitHub doesn't return total in body, but we can estimate from repo stats
    // For accuracy, just fetch all pages but limit to 2
    const page1 = await ghFetch(`${API}/repos/${REPO}/contributors?per_page=100&page=1`);
    totalContributors = Array.isArray(page1) ? page1.length : 0;
    if (totalContributors === 100) {
      const page2 = await ghFetch(`${API}/repos/${REPO}/contributors?per_page=100&page=2`);
      totalContributors += Array.isArray(page2) ? page2.length : 0;
    }
  } catch { /* skip */ }

  // 9. Star/Fork delta
  const prev = getLatest();
  const newStars = prev ? Math.max(0, repo.stargazers_count - prev.total_stars) : 0;
  const newForks = prev ? Math.max(0, repo.forks_count - prev.total_forks) : 0;

  return {
    date: d,
    new_prs: newPrs,
    merged_prs: mergedPrs,
    closed_prs: closedPrsUnmerged,
    avg_review_rounds: avgReviewRounds,
    open_prs: openPrs,
    pr_merge_rate: prMergeRate,
    new_issues: newIssues,
    closed_issues: closedIssues,
    open_issues: openIssues,
    zero_reply_issues: zeroReply,
    avg_issue_close_hours: avgCloseHours,
    daily_comments: dailyComments + prReviewComments,
    pr_review_comments: prReviewComments,
    commit_comments: 0,
    daily_commits: dailyCommits,
    total_commits: totalCommits,
    new_participants: todayUsers.size,
    active_users: todayUsers.size,
    total_stars: repo.stargazers_count,
    total_forks: repo.forks_count,
    new_stars: newStars,
    new_forks: newForks,
    total_watchers: repo.subscribers_count || 0,
    total_contributors: totalContributors,
    repo_size_kb: repo.size || 0,
    bug_issues: bugIssues,
    feature_issues: featureIssues,
    returning_users: returningUsers,
    first_time_contributors: firstTimeContributors,
    fetched_at: new Date().toISOString(),
  };
}
