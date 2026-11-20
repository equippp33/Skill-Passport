# STT relay

A standalone WebSocket bridge between the candidate's browser and Sarvam's
realtime speech-to-text, so the Sarvam API key never reaches the client. Runs
as its own process/container (Next 16 route handlers can't do a WebSocket
upgrade). Only used when streaming STT is enabled on the app
(`NEXT_PUBLIC_STT_STREAMING=1`); the default batch path doesn't touch it.

## Run

```
# local (loads apps/nextjs/.env)
pnpm --filter @skill-passport/nextjs stt-relay      # listens on :3100

# docker (built from repo-root Dockerfile.relay, which runs this script)
docker build -f Dockerfile.relay -t skill-passport-relay .
docker run --rm -p 3100:3100 -e SARVAM_API_KEY=... skill-passport-relay
```

## Env

See `.env.example`. Reads `SARVAM_API_KEY` (required), `STT_RELAY_PORT`
(default 3100), `SARVAM_STT_REALTIME_MODEL` (default `saaras:v3-realtime`).

## What it does

- Accepts a WebSocket upgrade on any path; the browser connects to `/stt-stream`.
- Opens an authenticated upstream socket to Sarvam realtime STT.
- Forwards browser PCM → Sarvam, and Sarvam transcript/VAD events → browser.
- Sends a keepalive every 25s so a quiet intro doesn't idle-timeout.
- Answers any non-upgrade HTTP request with `stt-relay ok` (doubles as a health check).
