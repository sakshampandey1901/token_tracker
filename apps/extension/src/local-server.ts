import * as http from "http";
import type { EventStore } from "./store";
import type { LlmProvider } from "@token-tracker/shared";

export interface LocalServer {
  stop(): Promise<void>;
}

/**
 * Starts a loopback-only HTTP server that other tools on the same machine
 * can POST events to. No auth — the socket is bound to 127.0.0.1, and any
 * process running as the same user could already read the store file on disk.
 */
export async function startLocalServer(port: number, store: EventStore): Promise<LocalServer> {
  const server = http.createServer(async (req, res) => {
    const remote = req.socket.remoteAddress ?? "";
    if (!remote.startsWith("127.") && remote !== "::1" && remote !== "::ffff:127.0.0.1") {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }

    if (req.method === "GET" && req.url === "/healthz") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, events: store.all().length }));
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
        const ev = await store.record({
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
        res.end(JSON.stringify(ev ? { accepted: 1, event: ev } : { accepted: 0, reason: "duplicate" }));
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
