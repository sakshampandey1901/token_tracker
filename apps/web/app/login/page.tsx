"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Activity, Mail } from "lucide-react";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signInEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const redirect = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirect },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  const signInOAuth = async (provider: "github" | "google") => {
    setError(null);
    const redirect = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: redirect },
    });
    if (error) setError(error.message);
  };

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-accent/20 grid place-items-center">
            <Activity className="h-5 w-5 text-accent" />
          </div>
          <div className="text-lg font-semibold">Sign in to Token Tracker</div>
        </div>

        {sent ? (
          <div className="mt-6 rounded-lg border border-border bg-bg p-4 text-sm">
            Check <b>{email}</b> for a magic link. You can close this tab.
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-2">
              <button
                onClick={() => signInOAuth("github")}
                className="w-full rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-bg"
              >
                Continue with GitHub
              </button>
              <button
                onClick={() => signInOAuth("google")}
                className="w-full rounded-lg border border-border px-4 py-2.5 text-sm hover:bg-bg"
              >
                Continue with Google
              </button>
            </div>

            <div className="my-5 flex items-center gap-3 text-xs text-muted">
              <div className="flex-1 border-t border-border" />
              or email
              <div className="flex-1 border-t border-border" />
            </div>

            <form onSubmit={signInEmail} className="grid gap-2">
              <label className="text-sm text-muted" htmlFor="email">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg bg-bg border border-border pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/40"
                  placeholder="you@example.com"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {loading ? "Sending…" : "Send magic link"}
              </button>
            </form>
          </>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 text-danger text-sm p-3">
            {error}
          </div>
        )}

        <button
          onClick={() => router.push("/")}
          className="mt-4 w-full text-xs text-muted hover:text-fg"
        >
          ← back to home
        </button>
      </div>
    </main>
  );
}
