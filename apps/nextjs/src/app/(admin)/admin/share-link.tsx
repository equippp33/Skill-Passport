"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Input } from "~/components/ui";

/**
 * The shareable candidate link.
 *
 * The absolute URL is built from `window.location.origin` so it is correct on
 * localhost, a preview deployment and production without a configured base
 * URL. It is written straight to the input's DOM value rather than held in
 * state: setting state from an effect would trigger a second render pass on
 * every mount for a value that never changes afterwards.
 */
export function ShareLink({ path }: { path: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = inputRef.current;
    if (el) el.value = `${window.location.origin}${path}`;
  }, [path]);

  async function copy() {
    const value = inputRef.current?.value ?? path;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the input stays selectable.
      inputRef.current?.select();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        ref={inputRef}
        readOnly
        defaultValue={path}
        onFocus={(e) => e.currentTarget.select()}
        aria-label="Candidate link"
        className="min-w-0 flex-1 font-mono text-xs"
      />
      <Button variant="secondary" size="md" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}
