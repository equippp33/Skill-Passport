"use client";

import { useRef, useState } from "react";

import { Button, Input } from "~/components/ui";

/**
 * The shareable candidate link.
 *
 * The URL arrives absolute and already resolved on the server — see
 * `~/server/app-url`. It used to be assembled here from
 * `window.location.origin`, which meant the link was whatever host this
 * particular admin had loaded, and was blank until hydration.
 */
export function ShareLink({ url }: { url: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    const value = inputRef.current?.value ?? url;
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
        defaultValue={url}
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
