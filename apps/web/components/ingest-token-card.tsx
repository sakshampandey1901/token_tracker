"use client";

import { useState } from "react";
import { Copy, RotateCcw, Check } from "lucide-react";

interface Props {
  token: string;
  supabaseUrl: string;
  onRotate: () => Promise<void>;
}

export function IngestTokenCard({ token, supabaseUrl, onRotate }: Props) {
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const masked = token.slice(0, 6) + "…" + token.slice(-4);

  const copy = async () => {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const rotate = async () => {
    if (!confirm("Rotating will invalidate existing extensions until reconfigured. Continue?")) return;
    setRotating(true);
    try {
      await onRotate();
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card h-full flex flex-col">
      <div className="text-xs uppercase tracking-wider text-muted">Extension pairing</div>
      <div className="mt-1 text-sm">
        Paste this into <code className="text-fg">Token Tracker: Sign in</code> in VS Code or Cursor.
      </div>

      <div className="mt-4 rounded-lg bg-bg border border-border p-3 font-mono text-sm break-all">
        {masked}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={copy}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-bg"
        >
          {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy token"}
        </button>
        <button
          onClick={rotate}
          disabled={rotating}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-bg disabled:opacity-50"
          title="Rotate ingest token"
        >
          <RotateCcw className={`h-4 w-4 ${rotating ? "animate-spin" : ""}`} />
        </button>
      </div>

      <details className="mt-4 text-xs text-muted">
        <summary className="cursor-pointer select-none">Endpoint</summary>
        <pre className="mt-2 whitespace-pre-wrap break-all">
          {`POST ${supabaseUrl}/functions/v1/ingest`}
        </pre>
      </details>
    </div>
  );
}
