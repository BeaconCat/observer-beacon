import type { DailyMetrics } from './db.ts';
import { getAllUsers, saveUsers, getLatest, getTodayNewUsers, saveTodayNewUsers } from './db.ts';

const REPO = (process.env.OBSERVER_REPO || 'BeaconCat/observer-beacon').trim();
const API = 'https://api.github.com';

// Clock offset: difference between GitHub server time and local system time (ms)
// Positive = local clock is behind, Negative = local clock is ahead
let clockOffsetMs = 0;

export async function calibrateClock(): Promise<void> {
  try {
    const res = await fetch(`${API}/rate_limit`, { headers: headers() });
    const serverDate = res.headers.get('date');
    if (serverDate) {
      const serverTime = new Date(serverDate).getTime();
      const localTime = Date.now();
      clockOffsetMs = serverTime - localTime;
      const offsetSec = Math.round(clockOffsetMs / 1000);
      console.log(`[CLOCK] Calibrated: offset=${offsetSec}s (${offsetSec > 0 ? 'local is behind' : 'local is ahead'})`);
    }
  } catch (e: any) {
    console.warn(`[CLOCK] Calibration failed: ${e.message} — using system clock`);
  }
}

// Get corrected current time
export function correctedNow(): Date {
  return new Date(Date.now() + clockOffsetMs);
}

// Internal alias
const now = correctedNow;

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

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 10_000;

async function ghFetch(url: string, retries = MAX_RETRIES): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: headers() });
      if (res.status === 403 || res.status === 429) {
        const reset = res.headers.get('x-ratelimit-reset');
        const resetIn = reset ? Math.ceil((Number(reset) * 1000 - Date.now()) / 60000) : '?';
        throw new Error(`GitHub API rate limit exceeded. Resets in ~${resetIn} min.`);
      }
      if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
      return res.json();
    } catch (e: any) {
      // Don't retry rate limit errors
      if (e.message?.includes('rate limit')) throw e;
      if (attempt < retries) {
        console.warn(`[RETRY] ${url.split('?')[0]} failed (${e.message}), retry ${attempt + 1}/${retries} in ${RETRY_DELAY_MS/1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      } else {
        throw e;
      }
    }
  }
}

// Stats APIs return 202 while computing. Retry up to 3 times with 2s delay, then fall back to general retry.
async function ghFetchStats(url: string): Promise<any> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: headers() });
      if (res.status === 200) return res.json();
      if (res.status === 202) {
        console.log(`[STATS] ${url} returned 202, retrying in 2s... (${i + 1}/3)`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      if (res.status === 403 || res.status === 429) throw new Error('Rate limit');
      throw new Error(`GitHub API ${res.status}`);
    } catch (e: any) {
      if (e.message?.includes('Rate limit')) throw e;
      if (i < 2) {
        console.warn(`[RETRY] stats ${url.split('?')[0]} failed (${e.message}), retry in ${RETRY_DELAY_MS/1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      } else {
        throw e;
      }
    }
  }
  return null; // Still 202 after retries
}

// Search API with retry: 1 request = 1 count
async function searchCount(query: string): Promise<number> {
  const url = `${API}/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: headers() });
      if (res.status === 422) {
        console.error(`[SEARCH] 422 (secondary rate limit): ${query}`);
        return -1; // Don't retry secondary rate limit
      }
      if (res.status === 403 || res.status === 429) {
        const reset = res.headers.get('x-ratelimit-reset');
        const remaining = res.headers.get('x-ratelimit-remaining');
        console.error(`[SEARCH] ${res.status} rate limit: ${query} | remaining=${remaining}, reset=${reset}`);
        return -1; // Don't retry rate limit
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
      }
      const data = await res.json();
      return data.total_count || 0;
    } catch (e: any) {
      if (attempt < MAX_RETRIES) {
        console.warn(`[SEARCH] ${query} failed (${e.message}), retry ${attempt + 1}/${MAX_RETRIES} in ${RETRY_DELAY_MS/1000}s...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      } else {
        console.error(`[SEARCH] ${query} failed after ${MAX_RETRIES} retries: ${e.message}`);
        return -1;
      }
    }
  }
  return -1;
}

function todayStr(): string { return now().toISOString().slice(0, 10); }

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

  // Abort if any search failed — don't write bad data
  const allCounts = [newPrs, mergedPrs, closedPrsUnmerged, openPrs, newIssues, closedIssues, openIssues, zeroReply, bugIssues, featureIssues];
  if (allCounts.some(c => c === -1)) {
    throw new Error('One or more GitHub Search API calls failed. Aborting to prevent writing zero data.');
  }

  // PR merge rate
  const totalResolved = mergedPrs + closedPrsUnmerged;
  const prMergeRate = totalResolved > 0 ? Math.round((mergedPrs / totalResolved) * 100) : 0;

  // 3. Commits today + participation stats
  // ghFetch already retries 10 times; catch = all retries exhausted → fallback
  const prevRecord = getLatest();
  let dailyCommits = 0;
  let totalCommits = 0;
  try {
    const commitsPage = await ghFetch(`${API}/repos/${REPO}/commits?since=${d}T00:00:00Z&until=${d}T23:59:59Z&per_page=100`);
    dailyCommits = Array.isArray(commitsPage) ? commitsPage.length : 0;
  } catch {
    dailyCommits = prevRecord?.daily_commits ?? 0;
    console.warn(`[FALLBACK] commits API failed — using previous daily_commits=${dailyCommits}`);
  }
  try {
    const participation = await ghFetchStats(`${API}/repos/${REPO}/stats/participation`);
    if (participation?.all) {
      totalCommits = (participation.all as number[]).reduce((a: number, b: number) => a + b, 0);
    }
  } catch { /* skip — handled below */ }
  if (totalCommits === 0 && prevRecord?.total_commits) {
    totalCommits = prevRecord.total_commits;
  }

  // 4. Comments today
  let dailyComments = 0;
  let prReviewComments = 0;
  try {
    const comments = await ghFetch(`${API}/repos/${REPO}/issues/comments?since=${d}T00:00:00Z&sort=created&direction=desc&per_page=100`);
    dailyComments = Array.isArray(comments) ? comments.filter((c: any) => c.created_at?.startsWith(d)).length : 0;
  } catch {
    dailyComments = prevRecord ? Math.max(0, prevRecord.daily_comments - prevRecord.pr_review_comments) : 0;
    console.warn(`[FALLBACK] issue comments API failed — using previous dailyComments=${dailyComments}`);
  }
  try {
    const prComments = await ghFetch(`${API}/repos/${REPO}/pulls/comments?since=${d}T00:00:00Z&sort=created&direction=desc&per_page=100`);
    prReviewComments = Array.isArray(prComments) ? prComments.filter((c: any) => c.created_at?.startsWith(d)).length : 0;
  } catch {
    prReviewComments = prevRecord?.pr_review_comments ?? 0;
    console.warn(`[FALLBACK] PR comments API failed — using previous prReviewComments=${prReviewComments}`);
  }

  // 5. Avg review rounds (sample up to 5 recent merged PRs)
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
          } catch {
            console.warn(`[FALLBACK] reviews API failed for PR #${pr.number} — counting as 0 rounds`);
          }
        }
        avgReviewRounds = Math.round((totalRounds / merged.length) * 10) / 10;
      }
    } catch {
      avgReviewRounds = prevRecord?.avg_review_rounds ?? 0;
      console.warn(`[FALLBACK] pulls API failed — using previous avgReviewRounds=${avgReviewRounds}`);
    }
  }

  // 6. Avg issue close time
  let avgCloseHours = 0;
  if (closedIssues > 0) {
    try {
      const searchRes = await ghFetch(`${API}/search/issues?q=${encodeURIComponent(`repo:${REPO} type:issue closed:${d}`)}&per_page=100`);
      const todayClosed = Array.isArray(searchRes?.items) ? searchRes.items : [];
      if (todayClosed.length > 0) {
        const totalHours = todayClosed.reduce((sum: number, i: any) => {
          return sum + (new Date(i.closed_at).getTime() - new Date(i.created_at).getTime()) / 3600000;
        }, 0);
        avgCloseHours = Math.round((totalHours / todayClosed.length) * 10) / 10;
      }
    } catch {
      avgCloseHours = prevRecord?.avg_issue_close_hours ?? 0;
      console.warn(`[FALLBACK] issue close time API failed — using previous avgCloseHours=${avgCloseHours}`);
    }
  }

  // 7. Users: committers + commenters
  const todayCommitters = new Set<string>();
  let committersFailed = false;
  try {
    const commitsPage = await ghFetch(`${API}/repos/${REPO}/commits?since=${d}T00:00:00Z&until=${d}T23:59:59Z&per_page=100`);
    if (Array.isArray(commitsPage)) {
      commitsPage.forEach((c: any) => {
        if (c.author?.login) todayCommitters.add(c.author.login);
      });
    }
  } catch {
    committersFailed = true;
    console.warn(`[FALLBACK] commits API failed — user stats will use fallback`);
  }

  const todayCommenters = new Set<string>();
  let commentersFailed = false;
  try {
    const recentActivity = await ghFetch(`${API}/repos/${REPO}/issues/comments?since=${d}T00:00:00Z&sort=created&per_page=100`);
    if (Array.isArray(recentActivity)) {
      recentActivity.filter((c: any) => c.created_at?.startsWith(d)).forEach((c: any) => {
        if (c.user?.login) todayCommenters.add(c.user.login);
      });
    }
  } catch {
    commentersFailed = true;
    console.warn(`[FALLBACK] comments API failed — user stats will use fallback`);
  }

  const allActiveToday = new Set([...todayCommitters, ...todayCommenters]);
  const usersFailed = committersFailed && commentersFailed;
  const activeUsers = usersFailed && prevRecord ? prevRecord.active_users : allActiveToday.size;
  const newParticipants = usersFailed && prevRecord ? prevRecord.new_participants : todayCommitters.size;

  // 7c. First-time contributors
  let knownUsers = getAllUsers();
  if (knownUsers.size === 0) {
    try {
      const page1 = await ghFetch(`${API}/repos/${REPO}/contributors?per_page=100&page=1`);
      if (Array.isArray(page1)) page1.forEach((c: any) => { if (c.login) knownUsers.add(c.login); });
      if (Array.isArray(page1) && page1.length === 100) {
        const page2 = await ghFetch(`${API}/repos/${REPO}/contributors?per_page=100&page=2`);
        if (Array.isArray(page2)) page2.forEach((c: any) => { if (c.login) knownUsers.add(c.login); });
      }
      saveUsers(knownUsers);
      console.log(`[SEED] Initialized known_users with ${knownUsers.size} contributors`);
    } catch {
      console.warn(`[FALLBACK] contributors seed failed — skipping`);
    }
  }

  const todayNewSoFar = getTodayNewUsers(d);
  const newCommitters = [...todayCommitters].filter(u => !knownUsers.has(u));
  newCommitters.forEach(u => todayNewSoFar.add(u));
  saveTodayNewUsers(todayNewSoFar);
  newCommitters.forEach(u => knownUsers.add(u));
  saveUsers(knownUsers);

  const firstTimeContributors = usersFailed && prevRecord ? prevRecord.first_time_contributors : todayNewSoFar.size;
  const returningUsers = usersFailed && prevRecord ? prevRecord.returning_users : [...todayCommitters].filter(u => knownUsers.has(u) && !todayNewSoFar.has(u)).length;

  // 8. Contributors
  let totalContributors = 0;
  try {
    const page1 = await ghFetchStats(`${API}/repos/${REPO}/contributors?per_page=100&page=1`);
    if (Array.isArray(page1)) {
      totalContributors = page1.length;
      if (totalContributors === 100) {
        const page2 = await ghFetchStats(`${API}/repos/${REPO}/contributors?per_page=100&page=2`);
        if (Array.isArray(page2)) totalContributors += page2.length;
      }
    }
  } catch {
    console.warn(`[FALLBACK] contributors API failed`);
  }
  if (totalContributors === 0 && prevRecord?.total_contributors) {
    totalContributors = prevRecord.total_contributors;
  }

  // 9. Star/Fork delta
  const newStars = prevRecord ? Math.max(0, repo.stargazers_count - prevRecord.total_stars) : 0;
  const newForks = prevRecord ? Math.max(0, repo.forks_count - prevRecord.total_forks) : 0;

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
    new_participants: newParticipants,
    active_users: activeUsers,
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
    fetched_at: now().toISOString(),
  };
}
