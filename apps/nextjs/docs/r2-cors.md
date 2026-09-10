# R2 CORS for webcam uploads

Answer **audio** is uploaded through the app server and needs nothing here.
Answer **video** has two paths, and this file is about the faster one.

## The two paths

1. **Direct.** The browser `PUT`s the recording straight to R2 with a
   presigned URL. The file never touches the app server, so it is not bounded
   by the platform request-body limit. This is a cross-origin request, so R2
   must return CORS headers for the app's origin — otherwise the browser's
   preflight is refused and nothing uploads.
2. **Relay.** `PUT /api/attempt/[attemptId]/answer-video` takes the bytes and
   writes them to R2 server-side. No bucket configuration at all, but the
   upload passes through the server and is capped by the request-body limit
   (4.5 MB on Vercel serverless; effectively unbounded on a long-lived Node
   server).

The client tries the direct path and silently falls back to the relay, so
video works with no configuration. Configure CORS to get path 1 — worth doing
before any deployment where the relay's body limit would bite.

## Symptom of missing CORS

A row in `interview_audio` with `kind = 'answer_video'` and `size_bytes = 0`
that is not referenced by `interview_turns.answer_video_id`. The row is
reserved by the `POST`, the browser upload then fails, and nothing links it.
The browser console shows a CORS error; the server logs show nothing, because
the failure happens entirely in the browser.

To check whether the bucket currently allows it:

```
OPTIONS <presigned url>
  Origin: http://localhost:3000
  Access-Control-Request-Method: PUT
  Access-Control-Request-Headers: content-type
```

A 403 with no `access-control-allow-origin` header means no rule matches.

## Configuring it

Cloudflare dashboard → **R2** → the bucket → **Settings** → **CORS policy**:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://your-domain.example"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

Notes:

- List every origin the app is served from. Origins are matched exactly —
  scheme, host and port all count, and there is no wildcard subdomain match.
- `AllowedMethods` needs only `PUT`. Playback is presigned `GET` issued
  through `/api/media/[audioId]` and is same-origin from the browser's point
  of view, so it does not need a rule.
- This does **not** make the bucket public. CORS governs which web origins may
  make the request; the presigned URL is still what authorises it, and it
  expires in `UPLOAD_URL_TTL_SECONDS`.
- An R2 API token scoped to _Object Read & Write_ cannot read or write the
  CORS policy — that needs account-level R2 admin permission, so the
  dashboard is usually the quickest route.
