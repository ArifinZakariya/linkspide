# Video Service (yt-dlp + ffmpeg)

Microservice terpisah untuk download video dari YouTube/Shorts, TikTok,
Instagram, Facebook, X (Twitter), dan Threads. Dipisah dari app utama karena
Vercel (serverless) tidak bisa menjalankan binary `yt-dlp` / `ffmpeg`.

App utama mem-proxy `/api/video/*` ke service ini lewat env `VIDEO_SERVICE_URL`.

## Endpoint

- `GET  /health` — status + daftar platform
- `POST /api/video/info` — body `{ "url": "..." }` → metadata + daftar kualitas
- `GET  /api/video/download?url=...&format=...&audio=0|1` — stream file

## Deploy ke Fly.io

Prasyarat: pasang `flyctl` dan login (`fly auth login`).

```bash
cd video-service

# 1. Buat app (sekali saja). Jangan deploy dulu.
fly launch --no-deploy
#  - Pakai nama app yang muncul / yang kamu pilih.
#  - Saat ditanya, biarkan pakai Dockerfile yang ada.

# 2. (Opsional) kunci CORS ke domain frontend kamu
fly secrets set ALLOWED_ORIGIN=https://NAMA-APP-KAMU.vercel.app

# 3. Deploy
fly deploy
```

Setelah selesai, catat URL-nya, contoh: `https://shortlink-video-service.fly.dev`

## Hubungkan ke app utama (Vercel)

Set environment variable di Vercel:

```
VIDEO_SERVICE_URL = https://shortlink-video-service.fly.dev
```

Lalu redeploy app utama. Tab Video Downloader akan otomatis memakai service ini.

## Test lokal

```bash
cd video-service
npm install
npm start            # jalan di port 3002

# app utama, di terminal lain, dari root repo:
$env:VIDEO_SERVICE_URL="http://127.0.0.1:3002"   # PowerShell
npm start
```

> Untuk tes lokal penuh perlu `yt-dlp` (wajib) dan `ffmpeg` (untuk merge
> kualitas tinggi). Di Docker/Fly.io keduanya sudah otomatis terpasang.

## Catatan

- `auto_stop_machines` aktif: mesin tidur saat idle (hemat biaya), bangun
  otomatis saat ada request. Request pertama setelah idle agak lambat (cold start).
- Download diarahkan (redirect) langsung dari browser ke service ini, jadi
  tidak terbebani limit payload/waktu di Vercel.
