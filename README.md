# Monitoring Dashboard

Simple system dashboard to view CPU, memory, storage, files, cron jobs, and PM2 processes.

## Features
- System stats (CPU, RAM, Storage)
- Workspace file explorer
- View and manage user crontab
- PM2 process list and logs
- File viewer and downloads

## Prerequisites
- Node.js (recommended v16+)
- npm
- pm2 (optional, for PM2 integration)

## Install
```bash
cd dashboard
npm install
```

## Run
```bash
# from repository root
cd dashboard
node server.js
# open http://localhost:3001
```

## Notes
- The dashboard serves static files from `public/` and exposes simple APIs in `server.js`.
- For production, run behind a reverse proxy (nginx) and use pm2 or systemd to manage the process.

## License
MIT
