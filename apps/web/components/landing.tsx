import Link from "next/link";
import { Activity, Shield, Gauge, Boxes } from "lucide-react";

export function Landing({ mode }: { mode: "login" | "setup" }) {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-accent/20 grid place-items-center">
            <Activity className="h-5 w-5 text-accent" />
          </div>
          <span className="text-lg font-semibold">Token Tracker</span>
        </div>
        {mode === "login" && (
          <Link
            href="/login"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            Sign in
          </Link>
        )}
      </header>

      <section className="mt-20 text-center">
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
          Live LLM token usage, on your screen, in real time.
        </h1>
        <p className="mt-4 text-muted max-w-2xl mx-auto text-base md:text-lg">
          Free, open source, and self-hostable. See your 24-hour rolling usage, compare weeks,
          and catch runaway spend before your quota does.
        </p>
        {mode === "login" ? (
          <div className="mt-8 flex justify-center gap-3">
            <Link
              href="/login"
              className="rounded-lg bg-accent px-5 py-3 text-sm font-medium text-white hover:bg-accent/90"
            >
              Get started
            </Link>
            <a
              href="https://github.com/your-org/token-tracker#readme"
              className="rounded-lg border border-border px-5 py-3 text-sm font-medium hover:bg-surface"
            >
              Read the docs
            </a>
          </div>
        ) : (
          <div className="mt-8 inline-flex flex-col items-center gap-3 rounded-xl border border-border bg-surface p-6 text-left">
            <p className="text-sm text-muted">
              Missing <code className="text-fg">NEXT_PUBLIC_SUPABASE_URL</code> /{" "}
              <code className="text-fg">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>.
            </p>
            <pre className="rounded-lg bg-bg p-3 text-xs text-fg border border-border">
cp .env.example apps/web/.env.local
# then fill in values from https://app.supabase.com
            </pre>
          </div>
        )}
      </section>

      <section className="mt-24 grid gap-6 md:grid-cols-3">
        <Feature
          icon={<Gauge className="h-5 w-5" />}
          title="Live 24-hour meter"
          body="Realtime usage against your plan's daily limit. Updates the moment your IDE makes a call."
        />
        <Feature
          icon={<Shield className="h-5 w-5" />}
          title="Secure by default"
          body="Row-level security on every table. API keys stay in OS-level secret storage, never in the repo."
        />
        <Feature
          icon={<Boxes className="h-5 w-5" />}
          title="Three ways to run it"
          body="Web dashboard, VS Code / Cursor extension, or `git clone` and self-host on Supabase's free tier."
        />
      </section>
    </main>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <div className="h-9 w-9 rounded-lg bg-accent/15 text-accent grid place-items-center">
        {icon}
      </div>
      <h3 className="mt-3 font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}
