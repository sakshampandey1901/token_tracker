import * as vscode from "vscode";
import { DEFAULTS } from "./defaults";

/**
 * Handles the handoff from the browser's /pair page.
 *
 * Flow:
 *   1. User clicks "Open VS Code" on tokentracker.example.com/pair
 *   2. Browser invokes  vscode://token-tracker.token-tracker/pair?code=<one-time>
 *   3. VS Code routes that URI here
 *   4. We POST the code to  <dashboardUrl>/api/pair/exchange
 *   5. Server returns  { ingest_token, supabase_url }
 *   6. We write both into settings + SecretStorage
 */
export async function handlePairUri(
  uri: vscode.Uri,
  ctx: vscode.ExtensionContext,
  secretKey: string,
  onDone: () => Promise<void>,
): Promise<void> {
  const params = new URLSearchParams(uri.query);
  const code = params.get("code");
  if (!code) {
    void vscode.window.showErrorMessage("Token Tracker: pairing URI missing `code` parameter.");
    return;
  }

  const cfg = vscode.workspace.getConfiguration("tokenTracker");
  const dashboardUrl =
    String(cfg.get("dashboardUrl") || "").trim() || DEFAULTS.dashboardUrl;

  if (!dashboardUrl) {
    void vscode.window.showErrorMessage(
      "Token Tracker: no dashboardUrl configured. Set `tokenTracker.dashboardUrl` or build the extension with TT_DASHBOARD_URL.",
    );
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Token Tracker: pairing…" },
    async () => {
      try {
        const res = await fetch(`${dashboardUrl.replace(/\/$/, "")}/api/pair/exchange`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`exchange ${res.status}: ${text.slice(0, 200)}`);
        }
        const data = (await res.json()) as {
          ingest_token: string;
          supabase_url: string;
          email?: string;
        };
        if (!data.ingest_token || !data.supabase_url) {
          throw new Error("missing fields in exchange response");
        }

        await cfg.update(
          "supabaseUrl",
          data.supabase_url.replace(/\/$/, ""),
          vscode.ConfigurationTarget.Global,
        );
        await ctx.secrets.store(secretKey, data.ingest_token);
        await onDone();

        void vscode.window.showInformationMessage(
          data.email
            ? `Token Tracker: connected as ${data.email}.`
            : "Token Tracker: connected.",
        );
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Token Tracker: pairing failed — ${(err as Error).message}`,
        );
      }
    },
  );
}

/**
 * Opens the dashboard /pair page in the user's default browser.
 * Uses `vscode.env.uriScheme` to tell the server which editor to hand off to.
 */
export async function openBrowserPair() {
  const cfg = vscode.workspace.getConfiguration("tokenTracker");
  const dashboardUrl =
    String(cfg.get("dashboardUrl") || "").trim() || DEFAULTS.dashboardUrl;

  if (!dashboardUrl) {
    const go = await vscode.window.showWarningMessage(
      "Token Tracker has no dashboard URL configured. Sign in manually?",
      "Sign in with code",
      "Cancel",
    );
    if (go === "Sign in with code") {
      await vscode.commands.executeCommand("tokenTracker.signInManual");
    }
    return;
  }

  const editor = vscode.env.uriScheme === "cursor" ? "cursor" : "vscode";
  const url = `${dashboardUrl.replace(/\/$/, "")}/pair?editor=${editor}`;
  void vscode.env.openExternal(vscode.Uri.parse(url));
}
