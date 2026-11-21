import { Hono } from "hono";

/**
 * One public HTTPS origin:
 *   - GET/UPGRADE /signal  -> bootstrap signaling endpoint (no chat payloads, no relay)
 *   - everything else      -> reverse proxy to the Next.js server on loopback
 */

const PUBLIC_PORT = Number(process.env.PUBLIC_PORT ?? 3443);
const NEXT_PORT = Number(process.env.NEXT_INTERNAL_PORT ?? 3001);
const NEXT_ORIGIN = `http://127.0.0.1:${NEXT_PORT}`;
const TLS_CERT_FILE = process.env.TLS_CERT_FILE;
const TLS_KEY_FILE = process.env.TLS_KEY_FILE;

type SocketData =
  | { kind: "signal" }
  | { kind: "next"; path: string; upstream?: WebSocket; queue: (string | ArrayBuffer)[] };

const app = new Hono();

app.all("/signal", (c) => c.text("Upgrade Required", 426, { Upgrade: "websocket" }));

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "te",
  "trailer",
  "host",
  "accept-encoding",
]);

async function proxyToNext(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers();
  for (const [k, v] of req.headers) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) {
      headers.set(k, v);
    }
  }
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-proto", "https");
  headers.set("x-forwarded-host", url.host);
  try {
    const upstream = await fetch(`${NEXT_ORIGIN}${url.pathname}${url.search}`, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      redirect: "manual",
    });
    const out = new Headers(upstream.headers);
    for (const h of HOP_BY_HOP) {
      out.delete(h);
    }
    out.delete("content-encoding");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out,
    });
  } catch {
    return new Response("Client server unavailable", { status: 502 });
  }
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!(origin && host)) {
    return false;
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const tls =
  TLS_CERT_FILE && TLS_KEY_FILE
    ? { cert: Bun.file(TLS_CERT_FILE), key: Bun.file(TLS_KEY_FILE) }
    : undefined;

if (!tls) {
  console.error("TLS_CERT_FILE and TLS_KEY_FILE are required: the app is served over HTTPS only.");
  process.exit(1);
}

const server = Bun.serve<SocketData>({
  port: PUBLIC_PORT,
  tls,
  fetch(req, srv) {
    const url = new URL(req.url);
    const isUpgrade = req.headers.get("upgrade")?.toLowerCase() === "websocket";
    if (url.pathname === "/signal") {
      if (isUpgrade) {
        if (!sameOrigin(req)) {
          return new Response("Forbidden", { status: 403 });
        }
        return srv.upgrade(req, { data: { kind: "signal" } })
          ? undefined
          : new Response("Upgrade failed", { status: 400 });
      }
      return app.fetch(req);
    }
    if (isUpgrade && process.env.NODE_ENV !== "production" && url.pathname.startsWith("/_next/")) {
      // Dev only: Next HMR socket.
      return srv.upgrade(req, {
        data: { kind: "next", path: `${url.pathname}${url.search}`, queue: [] },
      })
        ? undefined
        : new Response("Upgrade failed", { status: 400 });
    }
    return proxyToNext(req);
  },
  websocket: {
    maxPayloadLength: 64 * 1024,
    open(ws) {
      const data = ws.data;
      if (data.kind === "signal") {
        // Bootstrap only: acknowledge the upgrade. No payload is accepted or relayed.
        ws.send(JSON.stringify({ type: "ready" }));
        return;
      }
      const upstream = new WebSocket(`ws://127.0.0.1:${NEXT_PORT}${data.path}`);
      data.upstream = upstream;
      upstream.addEventListener("open", () => {
        for (const m of data.queue) {
          upstream.send(m);
        }
        data.queue = [];
      });
      upstream.addEventListener("message", (e) => ws.send(e.data as string));
      upstream.addEventListener("close", () => ws.close());
    },
    message(ws, message) {
      const data = ws.data;
      if (data.kind === "signal") {
        ws.close(1008, "unsupported");
        return;
      }
      const m = message as string | ArrayBuffer;
      if (data.upstream?.readyState === WebSocket.OPEN) {
        data.upstream.send(m);
      } else {
        data.queue.push(m);
      }
    },
    close(ws) {
      if (ws.data.kind === "next") {
        ws.data.upstream?.close();
      }
    },
  },
});

console.log(`glassroom listening on https://localhost:${server.port}`);
