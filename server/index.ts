import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDailyMetrics, getRawMetrics, getLatest } from './db.ts';
import { verifyPassword } from './auth.ts';
import { startCron, manualUpdate, getLastCronRun, getLastManualRun, isCronRunning, getIntervalMin } from './cron.ts';
import { toExcel, toCsv } from './export.ts';
import { getTokenStatus } from './github.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3175;

app.use(express.json({ limit: '1kb' }));

const PROJECT_NAME = (process.env.OBSERVER_NAME || 'Observer Beacon').trim();
const REPO_URL = (process.env.OBSERVER_REPO || 'BeaconCat/observer-beacon').trim();
const ACCENT_COLOR = (process.env.OBSERVER_ACCENT || '#00d4ff').trim();

// API: public config (no secrets)
app.get('/api/config', (_req, res) => {
  res.json({ name: PROJECT_NAME, repo: REPO_URL, accent: ACCENT_COLOR });
});

// API: query metrics (mode=daily|raw, default daily)
app.get('/api/metrics', (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const mode = req.query.mode === 'raw' ? 'raw' : 'daily';
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (from && !dateRe.test(from)) return res.status(400).json({ error: 'Invalid from date' });
    if (to && !dateRe.test(to)) return res.status(400).json({ error: 'Invalid to date' });
    res.json(mode === 'raw' ? getRawMetrics(from, to) : getDailyMetrics(from, to));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: latest
app.get('/api/metrics/latest', (_req, res) => {
  const latest = getLatest();
  if (!latest) return res.status(404).json({ error: 'No data yet' });
  res.json(latest);
});

// API: status
app.get('/api/status', (_req, res) => {
  const latest = getLatest();
  res.json({
    lastUpdate: latest?.fetched_at || null,
    lastCronRun: getLastCronRun(),
    lastManualRun: getLastManualRun(),
    cronRunning: isCronRunning(),
    intervalMin: getIntervalMin(),
    tokenStatus: getTokenStatus(),
  });
});

// API: verify password only (no update)
app.post('/api/verify', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const { password } = req.body || {};
  const auth = await verifyPassword(password, ip);
  if (!auth.ok) return res.status(auth.error?.includes('Too many') ? 429 : 401).json({ ok: false, error: auth.error });
  res.json({ ok: true });
});

// API: manual update (password protected, 30-min cooldown)
app.post('/api/update', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const { password } = req.body || {};
  const auth = await verifyPassword(password, ip);
  if (!auth.ok) return res.status(auth.error?.includes('Too many') ? 429 : 401).json({ ok: false, error: auth.error });

  try {
    await manualUpdate();
    const latest = getLatest();
    res.json({ ok: true, metrics: latest });
  } catch (e: any) {
    const isCooldown = e.message?.includes('cooldown');
    res.status(isCooldown ? 429 : 500).json({ ok: false, error: e.message });
  }
});

// API: export Excel
app.get('/api/export/excel', async (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const mode = req.query.mode === 'raw' ? 'raw' : 'daily';
    const data = mode === 'raw' ? getRawMetrics(from, to) : getDailyMetrics(from, to);
    const suffix = mode === 'raw' ? 'raw' : 'daily';
    const prefix = PROJECT_NAME.toLowerCase().replace(/\s+/g, '-');
    const buf = await toExcel(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${prefix}-${suffix}-${new Date().toISOString().slice(0,10)}.xlsx`);
    res.send(buf);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// API: export CSV
app.get('/api/export/csv', (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const mode = req.query.mode === 'raw' ? 'raw' : 'daily';
    const data = mode === 'raw' ? getRawMetrics(from, to) : getDailyMetrics(from, to);
    const suffix = mode === 'raw' ? 'raw' : 'daily';
    const prefix = PROJECT_NAME.toLowerCase().replace(/\s+/g, '-');
    const csv = toCsv(data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${prefix}-${suffix}-${new Date().toISOString().slice(0,10)}.csv`);
    res.send(csv);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Serve frontend (production)
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start
startCron();
app.listen(PORT, () => {
  const ts = getTokenStatus();
  console.log(`${PROJECT_NAME} Observer running at http://localhost:${PORT}`);
  console.log(`Repo: ${REPO_URL}`);
  console.log(`GitHub: ${ts === 'authenticated' ? 'Authenticated (5000 req/hr)' : 'Anonymous (60 req/hr)'}`);
});
