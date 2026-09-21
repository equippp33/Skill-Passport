/**
 * Realtime STT relay.
 *
 * The browser cannot talk to Sarvam's streaming STT directly — that would put
 * the API key in the client. This standalone WebSocket server sits between
 * them: the browser streams raw PCM here, this holds the authenticated upstream
 * socket to Sarvam, and Sarvam's transcript / VAD events are forwarded back.
 *
 * Deliberately its OWN process, not folded into Next: Next 16 route handlers
 * cannot do a WebSocket upgrade, and keeping it separate means the interview
 * app is untouched and this can be restarted on its own. Runs in the same
 * container as Next; a reverse-proxy rule routes `/stt-stream` here.
 *
 *   node --env-file=../../.env scripts/stt-relay.mjs
 *
 * Verified protocol (2026-09-21, saaras:v3-realtime):
 *   upstream : wss://api.sarvam.ai/speech-to-text-realtime/ws
 *   auth     : api-subscription-key header
 *   client→  : {"event":"audio_input","audio":"<base64 linear16 16k mono>"}
 *   →client  : session.begin | vad.speech_start | transcript.partial |
 *              vad.speech_end | transcript.final | session.end | error
 */
import { WebSocketServer, WebSocket } from "ws";

const KEY = process.env.SARVAM_API_KEY;
if (!KEY) {
  console.error("[relay] SARVAM_API_KEY missing — refusing to start");
  process.exit(1);
}

const PORT = Number(process.env.STT_RELAY_PORT) || 3001;
const MODEL = process.env.SARVAM_STT_REALTIME_MODEL || "saaras:v3-realtime";
const UPSTREAM = "wss://api.sarvam.ai/speech-to-text-realtime/ws";

/** BCP-47 code the client asked for, defaulting to English (India). */
function languageOf(reqUrl) {
  try {
    const u = new URL(reqUrl, "http://localhost");
    return u.searchParams.get("language_code") || "en-IN";
  } catch {
    return "en-IN";
  }
}

const server = new WebSocketServer({ port: PORT, path: "/stt-stream" });
server.on("listening", () =>
  console.log(`[relay] listening on :${PORT}/stt-stream (model ${MODEL})`),
);

server.on("connection", (client, req) => {
  const languageCode = languageOf(req.url);
  const upstreamUrl =
    `${UPSTREAM}?language_code=${encodeURIComponent(languageCode)}` +
    `&model=${encodeURIComponent(MODEL)}&stream_type=fast&endpointing=vad`;
  console.log(`[relay] client connected (lang=${languageCode})`);

  const upstream = new WebSocket(upstreamUrl, {
    headers: { "api-subscription-key": KEY },
  });

  // Audio that arrives before the upstream is open, held briefly then flushed
  // in order — the first ~100ms of an answer must not be dropped.
  const pending = [];
  let upstreamOpen = false;

  upstream.on("open", () => {
    upstreamOpen = true;
    for (const msg of pending) upstream.send(msg);
    pending.length = 0;
  });
  // Sarvam → browser: forward every event verbatim.
  upstream.on("message", (data) => {
    if (client.readyState === WebSocket.OPEN) client.send(data.toString());
  });
  upstream.on("close", (code, reason) => {
    console.log(`[relay] upstream closed code=${code} ${reason?.toString()?.slice(0, 120)}`);
    if (client.readyState === WebSocket.OPEN) client.close();
  });
  upstream.on("error", (err) => {
    console.error("[relay] upstream error", err.message);
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event: "error", message: "upstream_failed" }));
      client.close();
    }
  });

  // Browser → Sarvam: audio frames pass straight through.
  client.on("message", (data) => {
    const msg = data.toString();
    if (upstreamOpen) upstream.send(msg);
    else pending.push(msg);
  });
  client.on("close", () => {
    console.log("[relay] client closed");
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
    else upstream.terminate();
  });
  client.on("error", () => {
    if (upstream.readyState === WebSocket.OPEN) upstream.close();
  });
});

server.on("error", (err) => {
  console.error("[relay] server error", err.message);
  process.exit(1);
});
