import * as vscode from "vscode";
import type { ApiClient } from "./api-client";
import type { StatusBar } from "./status-bar";
import type { LlmProvider } from "@token-tracker/shared";
import { openBrowserPair } from "./pair";
import { DEFAULTS } from "./defaults";

interface Deps {
  api: ApiClient;
  status: StatusBar;
  secretKey: string;
  onAuthChange: () => Promise<void>;
}

export function registerCommands(ctx: vscode.ExtensionContext, deps: Deps) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("tokenTracker.signIn",        () => openBrowserPair()),
    vscode.commands.registerCommand("tokenTracker.signInManual",  () => signInManual(ctx, deps)),
    vscode.commands.registerCommand("tokenTracker.signOut",       () => signOut(ctx, deps)),
    vscode.commands.registerCommand("tokenTracker.openDashboard", () => openDashboard()),
    vscode.commands.registerCommand("tokenTracker.refresh",       () => deps.status.refreshNow()),
    vscode.commands.registerCommand("tokenTracker.reportUsage",   (raw) => reportUsage(deps.api, raw)),
  );
}

async function signInManual(ctx: vscode.ExtensionContext, deps: Deps) {
  const urlCurrent =
    String(vscode.workspace.getConfiguration("tokenTracker").get("supabaseUrl") ?? "") ||
    DEFAULTS.supabaseUrl;
  const url = await vscode.window.showInputBox({
    prompt: "Supabase project URL",
    value: urlCurrent || "https://YOUR-PROJECT.supabase.co",
    validateInput: (v) => (/^https:\/\/.+\.supabase\.co\/?$/.test(v.trim()) ? null : "Expected https://xxx.supabase.co"),
    ignoreFocusOut: true,
  });
  if (!url) return;

  const token = await vscode.window.showInputBox({
    prompt: "Ingest token (from the dashboard → Extension pairing → Copy)",
    placeHolder: "hex string, 64 chars",
    password: true,
    validateInput: (v) => (/^[a-f0-9]{32,128}$/i.test(v.trim()) ? null : "Expected hex token"),
    ignoreFocusOut: true,
  });
  if (!token) return;

  await vscode.workspace
    .getConfiguration("tokenTracker")
    .update("supabaseUrl", url.trim().replace(/\/$/, ""), vscode.ConfigurationTarget.Global);
  await ctx.secrets.store(deps.secretKey, token.trim());

  await deps.onAuthChange();
  vscode.window.showInformationMessage("Token Tracker: signed in.");
}

async function signOut(ctx: vscode.ExtensionContext, deps: Deps) {
  await ctx.secrets.delete(deps.secretKey);
  await deps.onAuthChange();
  vscode.window.showInformationMessage("Token Tracker: signed out. Ingest token cleared from Keychain.");
}

function openDashboard() {
  const url =
    String(vscode.workspace.getConfiguration("tokenTracker").get("dashboardUrl") || "").trim() ||
    DEFAULTS.dashboardUrl ||
    "http://localhost:3000";
  void vscode.env.openExternal(vscode.Uri.parse(url));
}

async function reportUsage(api: ApiClient, raw: unknown) {
  if (!raw || typeof raw !== "object") {
    vscode.window.showWarningMessage("tokenTracker.reportUsage: expected an object.");
    return;
  }
  const r = raw as {
    provider?: LlmProvider;
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    cached_tokens?: number;
    cost_usd?: number;
    source?: string;
    client_event_id?: string;
    occurred_at?: string;
  };
  if (!r.provider || !r.model) {
    vscode.window.showWarningMessage("tokenTracker.reportUsage: provider + model required.");
    return;
  }
  const out = await api.report({
    provider: r.provider,
    model: r.model,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    cached_tokens: r.cached_tokens,
    cost_usd: r.cost_usd,
    source: r.source ?? "programmatic",
    client_event_id: r.client_event_id,
    occurred_at: r.occurred_at,
  });
  if (!out) {
    vscode.window.showWarningMessage("Token Tracker not configured or offline.");
  }
}
