"use client";

import { Activity, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  email: string;
  displayName: string;
  connected: boolean;
  onSignOut: () => void;
}

export function Header({ email, displayName, connected, onSignOut }: Props) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-accent/20 grid place-items-center">
          <Activity className="h-5 w-5 text-accent" />
        </div>
        <div className="leading-tight">
          <div className="text-base font-semibold">Token Tracker</div>
          <div className="text-xs text-muted">{email}</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              connected ? "bg-ok animate-pulse" : "bg-muted",
            )}
            aria-hidden
          />
          <span className="text-muted">{connected ? "live" : "connecting…"}</span>
        </div>
        <button
          onClick={onSignOut}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface hover:text-fg"
          title={`Sign out (${displayName})`}
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
