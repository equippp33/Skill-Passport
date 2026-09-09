/**
 * Upload the webcam recording for one answer.
 *
 * Three steps: reserve a row and get a presigned URL, PUT the file straight to
 * R2 (so it never passes through the app server or its body limit), then tell
 * the server to verify and link it.
 *
 * Entirely best-effort. The interview is scored from the audio transcript, so
 * every failure here is logged and swallowed rather than surfaced — a broken
 * camera must not cost the candidate their answer.
 */
export async function uploadAnswerVideo(
  attemptId: string,
  turnNumber: number,
  video: Blob,
): Promise<void> {
  try {
    const ticketResponse = await fetch(
      `/api/attempt/${attemptId}/answer-video`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnNumber, mimeType: video.type }),
      },
    );
    if (!ticketResponse.ok) return;

    const { videoId, uploadUrl } = (await ticketResponse.json()) as {
      videoId: string;
      uploadUrl: string;
    };

    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": video.type },
      body: video,
    });
    if (!put.ok) return;

    await fetch(`/api/attempt/${attemptId}/answer-video`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnNumber, videoId }),
    });
  } catch {
    // Swallowed on purpose — see the note above.
  }
}
