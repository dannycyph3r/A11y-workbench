import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { GuardError, resolveAndCheck, type EgressPolicy } from "./url-guard";

/**
 * A per-scan forward proxy on 127.0.0.1. The scanning browser is pointed
 * at it with no bypass list, so every connection (navigation, redirect,
 * subresource, websocket) arrives here first. Each hop is resolved and
 * checked, then connected to the exact address that was checked, which
 * closes the DNS rebinding window. A byte budget caps total transfer.
 */

/** Marks responses the proxy generated itself, so the scanner can tell them from a site's own 403. */
export const BLOCK_HEADER = "x-awb-blocked";

export interface EgressProxy {
  url: string;
  bytes: () => number;
  blocked: () => { host: string; reason: string }[];
  close: () => Promise<void>;
}

export interface ProxyOptions {
  policy: EgressPolicy;
  maxBytes: number;
  connectTimeoutMs?: number;
  /** Optional corporate upstream proxy (http://host:port). DNS is still checked here first. */
  upstream?: string;
}

export async function startEgressProxy(opts: ProxyOptions): Promise<EgressProxy> {
  let total = 0;
  const blocked: { host: string; reason: string }[] = [];
  const sockets = new Set<net.Socket>();
  const connectTimeout = opts.connectTimeoutMs ?? 10_000;
  const upstream = opts.upstream ? new URL(opts.upstream) : null;

  const count = (n: number) => {
    total += n;
    if (total > opts.maxBytes) for (const s of sockets) s.destroy();
  };
  const track = (s: net.Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => s.destroy());
  };
  const deny = (host: string, err: unknown) => {
    const reason = err instanceof GuardError ? err.message : "Connection refused by scan policy.";
    blocked.push({ host, reason });
    return reason;
  };

  const server = http.createServer(async (req, res) => {
    // Plain HTTP, absolute-form request: "GET http://host/path HTTP/1.1"
    let target: URL;
    try {
      target = new URL(req.url ?? "");
      if (target.protocol !== "http:") throw new GuardError("unsupported-scheme", "Only http is proxied in plain form.");
    } catch {
      res.writeHead(400).end();
      return;
    }
    const port = target.port ? Number(target.port) : 80;
    try {
      const resolved = await resolveAndCheck(target.hostname, port, opts.policy);
      if (total > opts.maxBytes) throw new GuardError("blocked-address", "Scan transfer budget exceeded.");
      const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host };
      delete headers["proxy-connection"];
      delete headers["proxy-authorization"];
      const upstreamReq = http.request(
        upstream
          ? { host: upstream.hostname, port: Number(upstream.port || 80), method: req.method, path: target.href, headers, timeout: connectTimeout }
          : { host: resolved.address, family: resolved.family, port, method: req.method, path: target.pathname + target.search, headers, timeout: connectTimeout },
        (upRes) => {
          res.writeHead(upRes.statusCode ?? 502, upRes.headers);
          upRes.on("data", (chunk: Buffer) => count(chunk.length));
          upRes.pipe(res);
        },
      );
      upstreamReq.on("timeout", () => upstreamReq.destroy());
      upstreamReq.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstreamReq);
    } catch (err) {
      deny(target.hostname, err);
      res.writeHead(403, { "content-type": "text/plain", [BLOCK_HEADER]: "1" }).end("Blocked by scan policy");
    }
  });

  server.on("connect", async (req, clientSocket: net.Socket, head: Buffer) => {
    track(clientSocket);
    const [hostPart, portPart] = splitHostPort(req.url ?? "");
    const port = Number(portPart || 443);
    try {
      const resolved = await resolveAndCheck(hostPart, port, opts.policy);
      if (total > opts.maxBytes) throw new GuardError("blocked-address", "Scan transfer budget exceeded.");
      const remote = upstream
        ? net.connect({ host: upstream.hostname, port: Number(upstream.port || 80), timeout: connectTimeout })
        : net.connect({ host: resolved.address, family: resolved.family, port, timeout: connectTimeout });
      track(remote);
      remote.once("timeout", () => remote.destroy());
      remote.once("connect", () => {
        remote.setTimeout(0);
        const pipeThrough = () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) remote.write(head);
          remote.on("data", (chunk: Buffer) => count(chunk.length));
          remote.pipe(clientSocket);
          clientSocket.pipe(remote);
        };
        if (!upstream) return pipeThrough();
        // Chain through the upstream proxy. It resolves the name again, a
        // documented residual rebinding risk when an upstream is configured.
        remote.write(`CONNECT ${hostPart}:${port} HTTP/1.1\r\nHost: ${hostPart}:${port}\r\n\r\n`);
        let buf = "";
        const onData = (d: Buffer) => {
          buf += d.toString("latin1");
          const endOfHeaders = buf.indexOf("\r\n\r\n");
          if (endOfHeaders === -1) return;
          remote.off("data", onData);
          if (!/^HTTP\/1\.[01] 200/.test(buf)) {
            clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
            remote.destroy();
            return;
          }
          pipeThrough();
        };
        remote.on("data", onData);
      });
      remote.on("error", () => clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
    } catch (err) {
      deny(hostPart, err);
      clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    }
  });

  server.on("connection", track);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    bytes: () => total,
    blocked: () => [...blocked],
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

function splitHostPort(authority: string): [string, string] {
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    return [authority.slice(1, close), authority.slice(close + 2)];
  }
  const i = authority.lastIndexOf(":");
  return i === -1 ? [authority, ""] : [authority.slice(0, i), authority.slice(i + 1)];
}
