# QUANTJJ — Daily Pivot Levels

A TradingView-style candlestick chart for MT5 CSV exports, with automatic pivot level detection and Google Drive integration.

## Features

- 📊 Candlestick chart powered by TradingView's lightweight-charts
- 📁 Google Drive integration — auto-loads CSV files from a shared Drive folder
- 📈 Pivot Levels (support & resistance) read from CSV columns H–O
- ⏱️ Timeframe auto-detection (M1, M5, M15, H1, H4, D1, etc.)
- 🔴 Online user counter (in-memory heartbeat)
- 📱 Responsive design (desktop + mobile)
- 🌙 Dark theme

## Setup

### Environment Variables

Create a `.env.local` file (or set these in your Vercel project settings):

```
GOOGLE_DRIVE_API_KEY=your-google-drive-api-key
DATABASE_URL="file:./db/custom.db"
```

### Google Drive Setup

1. Create a Google Cloud project and enable the Google Drive API
2. Create an API key
3. Share your Drive folder as "Anyone with the link can view"
4. Set the folder ID and API key in `src/app/api/drive-files/route.ts`

### CSV Format

The app expects CSV files with at minimum:
- Column A: Date (e.g. `2026.10.01 00:00` or `20261001`)
- Column B: Open
- Column C: High
- Column D: Low
- Column E: Close
- Column F: Volume (optional)
- Columns H–O: Pivot levels (Resistance I/II/III, Support I/II/III)

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy

Deploy on Vercel — just connect your GitHub repo and add the environment variables.
