"use client";

import { useEffect, useRef } from "react";

import { Icon } from "~/components/ui/icon";
import { cn } from "~/lib/utils";

/**
 * The candidate's self-view, used everywhere the camera rail appears.
 *
 * With a stream it mirrors the live feed (like a mirror, and muted so it never
 * feeds back into a recording). Without one it shows the "your face will be
 * here" placeholder, so the rail holds its shape before the camera is on
 * rather than collapsing and shifting the layout the moment it starts.
 */
export function CameraPreview({
  stream,
  placeholder = "Camera preview",
  hint,
  className,
}: {
  stream?: MediaStream | null;
  placeholder?: string;
  hint?: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  // A MediaStream cannot be passed through `src`, so it is attached here.
  useEffect(() => {
    const el = ref.current;
    if (el) el.srcObject = stream ?? null;
  }, [stream]);

  return (
    <div
      className={cn(
        "relative aspect-video overflow-hidden rounded-2xl border border-border-subtle bg-content/90",
        className,
      )}
    >
      {stream ? (
        <>
          <video
            ref={ref}
            autoPlay
            muted
            playsInline
            aria-label="Your camera"
            className="h-full w-full -scale-x-100 object-cover"
          />
          <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white">
            <span className="size-2 animate-pulse rounded-full bg-danger" />
            Live
          </span>
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-surface-muted px-6 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-surface text-content-muted">
            <Icon name="camera" className="size-8" />
          </span>
          <div className="max-w-xs">
            <p className="text-base font-medium text-content">{placeholder}</p>
            {hint ? (
              <p className="mt-1.5 text-sm leading-relaxed text-content-muted">
                {hint}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
