# Observer Beacon

A lightweight, self-hosted GitHub repository monitoring dashboard. Track PRs, issues, commits, community activity, and growth metrics with auto-scheduled data collection and a dark-themed real-time panel.

Built for open-source maintainers and community managers who need a quick pulse on their project's health.

## Features

- **4-section dashboard**: Growth & Acquisition, PR Health, Issue Health, Community Activity
- **29 tracked metrics**: stars, forks, PRs, issues, commits, comments, contributors, retention, and more
- **Auto-fetch**: configurable interval (default 30min) via cron
- **Manual update**: password-protected with rate limiting and brute-force protection
- **Dual view mode**: Daily (one row per day, closest to midnight) / Raw (every fetch as a row)
- **Export**: Excel (.xlsx) and CSV download, respects current view mode and date range
- **XML storage**: human-readable, git-friendly, zero-config (no database needed)
- **Fully configurable**: project name, repo, password, accent color, interval — all via `.env`
- **Dark theme**: black background, glow accents, custom scrollbars, smooth animations
- **Mobile responsive**: adaptive grid layout for all screen sizes
- **Toast notifications**: API errors shown as non-intrusive toasts, never interrupts your workflow
- **Security**: bcrypt password hashing, 500ms timing-attack delay, IP-based rate limiting (5 attempts / 15min)

## Quick Start

```bash
git clone https://github.com/BeaconCat/observer-beacon.git
cd observer-beacon
cp .env.example .env
# Edit .env: add your GitHub token, change password
pnpm install
pnpm build
pnpm start
# Open http://localhost:3175
```

## Configuration

All settings in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `GITHUB_TOKEN` | — | GitHub PAT (`ghp_` or `github_pat_` prefix). Without it, limited to 60 req/hr |
| `OBSERVER_NAME` | `Observer Beacon` | Display name in the header (supports spaces) |
| `OBSERVER_REPO` | `BeaconCat/observer-beacon` | GitHub repo to monitor (`owner/repo`) |
| `OBSERVER_PASSWORD` | `pl3ase_ch@nge_m3` | Password for manual update trigger |
| `OBSERVER_ACCENT` | `"#00d4ff"` | Title hover glow color (hex, must quote the `#`) |
| `OBSERVER_INTERVAL` | `30` | Auto-fetch interval in minutes |
| `PORT` | `3175` | Server port |

## GitHub Token

Go to [GitHub Settings > Tokens](https://github.com/settings/tokens?type=beta) > Generate new token > select **Public Repositories (read-only)**. No write permissions needed — the token only increases the API rate limit from 60 to 5,000 requests/hour.

## Tech Stack

- **Frontend**: Vue 3 + Naive UI (dark theme) + ECharts + Iconify (Carbon icons, offline)
- **Backend**: Express.js + tsx
- **Storage**: XML (fast-xml-parser)
- **Auth**: bcryptjs + rate-limiter-flexible
- **Scheduler**: node-cron
- **Export**: ExcelJS
- **Package manager**: pnpm

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Project name, repo, accent color |
| `GET` | `/api/status` | Last update times, token status, interval |
| `GET` | `/api/metrics?from=&to=&mode=daily\|raw` | Query metrics |
| `GET` | `/api/metrics/latest` | Latest record |
| `POST` | `/api/verify` | Verify password only |
| `POST` | `/api/update` | Trigger manual fetch (password required) |
| `GET` | `/api/export/excel?from=&to=&mode=` | Download .xlsx |
| `GET` | `/api/export/csv?from=&to=&mode=` | Download .csv |

## Deployment

### PM2 (recommended)

```bash
pnpm build
pm2 start "pnpm start" --name observer-beacon
pm2 save
```

### Docker (DIY)

No official Dockerfile yet. The app is a single Node.js process serving static files + API. Mount `data/` for persistence and pass `.env` vars.

### Reverse Proxy (Nginx)

```nginx
location / {
    proxy_pass http://127.0.0.1:3175;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

## License

MIT

## Author

[BeaconCat](https://github.com/BeaconCat)
