/**
 * Upload the webcam recording for one answer.
 *
 * Reserve a row, get the bytes to R2, then have the server verify and link
 * them. There are two ways to do the middle step:
 *
 *  1. PUT straight to R2 with the presigned URL. The file never touches the
 *     app server, so it is not bounded by the request-body limit. This is a
 *     cross-origin request and needs a CORS rule on the bucket.
 *  2. PUT to our own route, which relays it. Slower and size-limited, but it
 *     needs no bucket configuration.
 *
 * We try (1) and fall back to (2), rather than picking one: a missing CORS
 * rule is invisible from here — the browser reports it as a generic network
 * failure — so the fallback is what makes the feature work out of the box.
 *
 * Entirely best-effort either way. The interview is scored from the audio
 * transcript, so every failure here is swallowed rather than surfaced — a
 * broken camera must not cost the candidate their answer.
 *
 * Returns whether the recording actually landed, so a caller holding a
 * queue can put a failed one back rather than losing it silently.
 */
export async function uploadAnswerVideo(
  attemptId: string,
  turnNumber: number,
  video: Blob,
  durationMs?: number,
): Promise<boolean> {
  try {
    const ticketResponse = await fetch(
      `/api/attempt/${attemptId}/answer-video`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          turnNumber,
          mimeType: video.type,
          durationMs,
        }),
      },
    );
    if (!ticketResponse.ok) return false;

    const { videoId, uploadUrl } = (await ticketResponse.json()) as {
      videoId: string;
      uploadUrl: string;
    };

    if (await putDirect(uploadUrl, video)) {
      const linked = await fetch(`/api/attempt/${attemptId}/answer-video`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnNumber, videoId }),
      });
      return linked.ok;
    }

    // The relay verifies and links in the same request, so there is no
    // separate PATCH on this path.
    const params = new URLSearchParams({
      turnNumber: String(turnNumber),
      videoId,
    });
    const relayed = await fetch(
      `/api/attempt/${attemptId}/answer-video?${params}`,
      {
        method: "PUT",
        headers: { "Content-Type": video.type },
        body: video,
      },
    );
    return relayed.ok;
  } catch {
    // Swallowed on purpose — see the note above.
    return false;
  }
}

/**
 * Attempt the direct upload. A CORS refusal rejects the fetch outright
 * rather than returning a status, so both outcomes mean "fall back".
 */
async function putDirect(uploadUrl: string, video: Blob): Promise<boolean> {
  try {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": video.type },
      body: video,
    });
    return response.ok;
  } catch {
    return false;
  }
}
