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
 * container-set as Next; a reverse-proxy rule routes its subdomain here.
 *
 *   node --env-file=../../.env scripts/stt-relay.mjs
 *
 * The HTTP server answers any non-upgrade request with "stt-relay ok" so the
 * subdomain doubles as a health check, and the upgrade is accepted on ANY path
 * (behind a proxy the path can be rewritten; a strict path filter silently
 * dropped upgrades). Every upgrade is logged so a failing connection is visible.
 *
 * Verified protocol (2026-09-21, saaras:v3-realtime):
 *   upstream : wss://api.sarvam.ai/speech-to-text-realtime/ws
 *   auth     : api-subscription-key header
 *   client→  : {"event":"audio_input","audio":"<base64 linear16 16k mono>"}
 *   →client  : session.begin | vad.speech_start | transcript.partial |
 *              vad.speech_end | transcript.final | session.end | error
 */
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const KEY = process.env.SARVAM_API_KEY;
if (!KEY) {
  console.error("[relay] SARVAM_API_KEY missing — refusing to start");
  process.exit(1);
}

const PORT = Number(process.env.STT_RELAY_PORT) || 3100;
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

// Plain HTTP server: anything that is not a WebSocket upgrade gets a 200, so
// hitting the subdomain in a browser confirms the relay is reachable.
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("stt-relay ok\n");
});

// noServer + manual upgrade: accept on any path and log it, rather than letting
// `ws`'s path filter drop mismatched upgrades silently behind the proxy.
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  console.log(`[relay] upgrade url=${req.url}`);
  wss.handleUpgrade(req, socket, head, (client) => {
    wss.emit("connection", client, req);
  });
});

wss.on("connection", (client, req) => {
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

  /**
   * Keep both hops warm during a silent stretch.
   *
   * The opening can sit quiet for a minute-plus (the candidate is still
   * answering, just between parts), and in silence the browser sends no audio,
   * so nothing crosses the wire. Cloudflare cuts an idle WebSocket after ~100s;
   * when it does, the stream drops to the batch fallback — where Sarvam
   * hallucinates canned filler out of the silence. A ping every 25s on each hop
   * is traffic Cloudflare counts, with no audio and nothing to transcribe, so
   * the live stream survives the quiet and never falls back.
   */
  const keepAlive = setInterval(() => {
    try {
      // A DATA frame, not a ping: Cloudflare does not always count ping/pong as
      // activity, so a ping-only keepalive still gets the idle socket cut. The
      // browser ignores an unknown event (its message switch has no case for
      // it), so this is invisible to the interview but keeps the hop alive.
      if (client.readyState === WebSocket.OPEN)
        client.send(JSON.stringify({ event: "keepalive" }));
      // Upstream goes straight to Sarvam (not through Cloudflare); a ping keeps
      // that side warm without sending audio it would try to transcribe.
      if (upstream.readyState === WebSocket.OPEN) upstream.ping();
    } catch {
      // A send on a socket mid-close is harmless to miss.
    }
  }, 25000);

  upstream.on("open", () => {
    upstreamOpen = true;
    for (const msg of pending) upstream.send(msg);
    pending.length = 0;
  });
  upstream.on("message", (data) => {
    const text = data.toString();
    // Surface Sarvam-side errors in the relay log for diagnosis.
    if (text.includes('"error"')) {
      console.log("[relay] upstream ERROR msg:", text.slice(0, 400));
    }
    if (client.readyState === WebSocket.OPEN) client.send(text);
  });
  upstream.on("close", (code, reason) => {
    clearInterval(keepAlive);
    console.log(
      `[relay] upstream closed code=${code} ${reason?.toString()?.slice(0, 120)}`,
    );
    if (client.readyState === WebSocket.OPEN) client.close();
  });
  upstream.on("error", (err) => {
    console.error("[relay] upstream error", err.message);
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event: "error", message: "upstream_failed" }));
      client.close();
    }
  });

  client.on("message", (data) => {
    const msg = data.toString();
    if (upstreamOpen) upstream.send(msg);
    else pending.push(msg);
  });
  client.on("close", () => {
    clearInterval(keepAlive);
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

server.listen(PORT, () =>
  console.log(`[relay] listening on :${PORT} (model ${MODEL})`),
);
