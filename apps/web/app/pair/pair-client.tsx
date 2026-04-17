"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Check, Loader2 } from "lucide-react";

const EXTENSION_ID = "token-tracker.token-tracker";

type Status =
  | { kind: "idle" }
  | { kind: "minting" }
  | { kind: "handing-off"; deepLink: string; code: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

interface Props {
  editor: "vscode" | "cursor";
  autoStart: boolean;
  email: string;
}

export function PairClient({ editor, autoStart, email }: Props) {
  const [chosen, setChosen] = useState<"vscode" | "cursor">(editor);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const start = useCallback(
    async (target: "vscode" | "cursor") => {
      setChosen(target);
      setStatus({ kind: "minting" });
      try {
        const res = await fetch("/api/pair/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ editor: target }),
        });
        if (!res.ok) throw new Error(`create failed: ${res.status}`);
        const { code } = (await res.json()) as { code: string };

        const scheme = target === "cursor" ? "cursor" : "vscode";
        const deepLink = `${scheme}://${EXTENSION_ID}/pair?code=${encodeURIComponent(code)}`;
        setStatus({ kind: "handing-off", deepLink, code });
        window.location.href = deepLink;
      } catch (err) {
        setStatus({ kind: "error", message: (err as Error).message });
      }
    },
    [],
  );

  useEffect(() => {
    if (autoStart && status.kind === "idle") void start(editor);
  }, [autoStart, editor, start, status.kind]);

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-accent/20 grid place-items-center">
          <Activity className="h-5 w-5 text-accent" />
        </div>
        <span className="text-lg font-semibold">Connect editor</span>
      </div>

      <p className="mt-4 text-sm text-muted">
        Signed in as <span className="text-fg">{email}</span>.
      </p>

      {status.kind === "idle" && (
        <div className="mt-8 grid gap-3">
          <EditorButton label="Open VS Code"      onClick={() => start("vscode")} primary={chosen === "vscode"} />
          <EditorButton label="Open Cursor"       onClick={() => start("cursor")} primary={chosen === "cursor"} />
          <p className="text-xs text-muted mt-2">
            We&apos;ll mint a single-use code that expires in 5 minutes and hand it to your editor.
            Your ingest token never appears in the URL.
          </p>
        </div>
      )}

      {status.kind === "minting" && (
        <Card>
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          <span>Minting one-time code…</span>
        </Card>
      )}

      {status.kind === "handing-off" && (
        <>
          <Card>
            <Check className="h-5 w-5 text-ok" />
            <span>Handing off to {chosen === "cursor" ? "Cursor" : "VS Code"}…</span>
          </Card>
          <div className="mt-4 text-sm text-muted">
            If your editor didn&apos;t open,{" "}
            <a className="text-accent hover:underline" href={status.deepLink}>click here</a>.
          </div>
          <p className="mt-8 text-xs text-muted">
            You can close this tab once the status-bar item appears in your editor.
          </p>
        </>
      )}

      {status.kind === "error" && (
        <Card tone="error">
          <span>Could not pair: {status.message}</span>
        </Card>
      )}

      <div className="mt-10">
        <Link href="/" className="text-xs text-muted hover:text-fg">← dashboard</Link>
      </div>
    </main>
  );
}

function EditorButton({
  label,
  onClick,
  primary,
}: {
  label: string;
  onClick: () => void;
  primary: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={
        primary
          ? "rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white hover:bg-accent/90"
          : "rounded-lg border border-border px-4 py-3 text-sm font-medium hover:bg-surface"
      }
    >
      {label}
    </button>
  );
}

function Card({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "error" }) {
  return (
    <div
      className={
        "mt-6 flex items-center gap-3 rounded-xl border p-4 " +
        (tone === "error"
          ? "border-danger/40 bg-danger/10 text-danger"
          : "border-border bg-surface text-fg")
      }
    >
      {children}
    </div>
  );
}
