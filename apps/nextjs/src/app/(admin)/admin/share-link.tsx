"use client";

import { useRef, useState } from "react";

import { Icon } from "~/components/ui/icon";
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
  const [copyError, setCopyError] = useState(false);

  async function copy() {
    setCopyError(false);
    const value = inputRef.current?.value ?? url;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the input stays selectable.
      inputRef.current?.select();
      setCopyError(true);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          ref={inputRef}
          readOnly
          defaultValue={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Candidate link"
          className="min-w-0 flex-1 bg-surface font-mono text-sm"
        />
        <Button variant="primary" size="md" onClick={() => void copy()}>
          <Icon name={copied ? "check" : "copy"} />
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p role="status" className="text-xs text-content-muted">
        {copied
          ? "Link copied. Ready to share with candidates."
          : copyError
            ? "Copy is unavailable. The link is selected; copy it manually."
            : "Anyone with this link can begin their own interview."}
      </p>
    </div>
  );
}
