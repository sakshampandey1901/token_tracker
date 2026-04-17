import * as http from "http";
import type { ApiClient } from "./api-client";
import type { LlmProvider } from "@token-tracker/shared";

export interface LocalServer {
  stop(): Promise<void>;
}

/**
 * Starts a loopback-only HTTP server that other tools on the same machine
 * can POST events to without knowing anything about Supabase.
 *
 * Security: bound to 127.0.0.1 (not 0.0.0.0). Any process running as the
 * same user could reach it — which is already true for env vars and files,
 * so we don't add extra auth here.
 */
export async function startLocalServer(port: number, api: ApiClient): Promise<LocalServer> {
  const server = http.createServer(async (req, res) => {
    // Only accept loopback. Node already binds to 127.0.0.1, but double-check.
    const remote = req.socket.remoteAddress ?? "";
    if (!remote.startsWith("127.") && remote !== "::1") {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }

    if (req.method === "GET" && req.url === "/healthz") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, configured: await api.isConfigured() }));
      return;
    }

    if (req.method !== "POST" || req.url !== "/ingest") {
      res.statusCode = 404;
      res.end("not_found");
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      try {
        const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!raw?.provider || !raw?.model) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "missing_fields" }));
          return;
        }
        const result = await api.report({
          provider: raw.provider as LlmProvider,
          model: String(raw.model),
          input_tokens: Number(raw.input_tokens ?? 0),
          output_tokens: Number(raw.output_tokens ?? 0),
          cached_tokens: Number(raw.cached_tokens ?? 0),
          cost_usd: raw.cost_usd != null ? Number(raw.cost_usd) : undefined,
          source: raw.source ?? "local-ingest",
          client_event_id: raw.client_event_id,
          occurred_at: raw.occurred_at,
        });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(result ?? { error: "not_configured" }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "invalid_json", detail: String(err) }));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListen);
      reject(err);
    };
    const onListen = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListen);
    server.listen(port, "127.0.0.1");
  });

  return {
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
