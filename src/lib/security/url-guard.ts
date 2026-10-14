import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * Server-side request forgery defences for the URL scanner. Every host
 * the scanning browser contacts (the page, its redirects and every
 * subresource) passes through these checks inside the egress proxy.
 */

export type GuardCode =
  | "invalid-url"
  | "unsupported-scheme"
  | "credentials-in-url"
  | "blocked-port"
  | "blocked-hostname"
  | "blocked-address"
  | "dns-failure";

export class GuardError extends Error {
  constructor(
    public code: GuardCode,
    message: string,
  ) {
    super(message);
  }
}

export interface EgressPolicy {
  /** Ports the scanner may connect to. */
  allowedPorts: Set<number>;
  /**
   * "host:port" pairs allowed even though they resolve to private space.
   * Empty in production. Used by tests and the documented dev allowlist.
   */
  privateAllowlist: Set<string>;
  resolver?: (host: string) => Promise<{ address: string; family: number }[]>;
}

export function defaultPolicy(): EgressPolicy {
  const allow = new Set<string>();
  if (process.env.NODE_ENV !== "production") {
    for (const entry of (process.env.SCAN_DEV_ALLOWLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
      allow.add(entry.toLowerCase());
    }
  }
  return { allowedPorts: new Set([80, 443, 8080, 8443]), privateAllowlist: allow };
}

const BLOCKED_NAMES = [/^localhost$/, /\.localhost$/, /\.local$/, /\.internal$/, /\.home\.arpa$/, /\.lan$/, /\.intranet$/, /^metadata\.google\.internal$/, /\.invalid$/, /\.test$/];

/** Parses and statically validates a user-supplied URL. Does not touch the network. */
export function validateUrlSyntax(input: string, policy: EgressPolicy): URL {
  const trimmed = input.trim();
  if (trimmed.length > 2048) throw new GuardError("invalid-url", "That URL is longer than 2,048 characters.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new GuardError("invalid-url", "Enter a full address that starts with https:// or http://.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new GuardError("unsupported-scheme", `Only http and https pages can be scanned, not ${url.protocol.replace(":", "")}.`);
  }
  if (url.username || url.password) {
    throw new GuardError("credentials-in-url", "Remove the username or password from the URL. The scanner does not sign in to sites.");
  }
  const port = effectivePort(url);
  const host = normalizeHost(url.hostname);
  const allowKey = `${host}:${port}`;
  if (!policy.privateAllowlist.has(allowKey)) {
    if (BLOCKED_NAMES.some((re) => re.test(host))) {
      throw new GuardError("blocked-hostname", "Local and internal host names cannot be scanned.");
    }
    if (isIP(host)) {
      const reason = blockedReason(host);
      if (reason) throw new GuardError("blocked-address", `That address is in ${reason} space and cannot be scanned.`);
    }
  }
  // Checked after the host so the most relevant reason is the one reported.
  if (!policy.allowedPorts.has(port) && !policy.privateAllowlist.has(allowKey)) {
    throw new GuardError("blocked-port", `Port ${port} is not allowed. The scanner connects to ports 80, 443, 8080 and 8443.`);
  }
  return url;
}

export function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

export function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

// ---- IP classification -------------------------------------------------

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number, string][] = [
  ["0.0.0.0", 8, "unspecified"],
  ["10.0.0.0", 8, "private"],
  ["100.64.0.0", 10, "carrier-grade NAT"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local"],
  ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "IETF protocol"],
  ["192.0.2.0", 24, "documentation"],
  ["192.88.99.0", 24, "relay"],
  ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "benchmarking"],
  ["198.51.100.0", 24, "documentation"],
  ["203.0.113.0", 24, "documentation"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved"],
];

function blockedV4(ip: string): string | null {
  const n = v4ToInt(ip);
  for (const [base, bits, label] of V4_BLOCKS) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((n & mask) === (v4ToInt(base) & mask)) return label;
  }
  return null;
}

/** Expands an IPv6 address to eight 16-bit groups. */
export function expandV6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  let tail: number[] = [];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4 && v4[1]) {
    const n = v4ToInt(v4[1]);
    tail = [(n >>> 16) & 0xffff, n & 0xffff];
    addr = addr.slice(0, addr.length - v4[1].length) + "0:0";
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 && fill !== 0) return null;
  if (fill < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...rest].map((g) => parseInt(g || "0", 16));
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  if (tail.length) {
    groups[6] = tail[0]!;
    groups[7] = tail[1]!;
  }
  return groups;
}

function embeddedV4(g: number[], hi: number, lo: number): string {
  return [g[hi]! >> 8, g[hi]! & 0xff, g[lo]! >> 8, g[lo]! & 0xff].join(".");
}

function blockedV6(ip: string): string | null {
  const g = expandV6(ip);
  if (!g) return "unparseable";
  if (g.every((x) => x === 0)) return "unspecified";
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return "loopback";
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return blockedV4(embeddedV4(g, 6, 7)) ?? (g[5] === 0 ? "deprecated IPv4-compatible" : null);
  // NAT64 64:ff9b::/96 embeds an IPv4 address
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return blockedV4(embeddedV4(g, 6, 7));
  // 6to4 2002::/16 embeds an IPv4 address in groups 1 and 2
  if (g[0] === 0x2002) return blockedV4(embeddedV4(g, 1, 2));
  if (g[0] === 0x2001 && g[1] === 0) return "Teredo tunnel";
  if (g[0] === 0x2001 && g[1] === 0xdb8) return "documentation";
  if ((g[0]! & 0xfe00) === 0xfc00) return "unique local (private)";
  if ((g[0]! & 0xffc0) === 0xfe80) return "link-local";
  if ((g[0]! & 0xffc0) === 0xfec0) return "site-local";
  if ((g[0]! & 0xff00) === 0xff00) return "multicast";
  if (g[0] === 0x100 && g.slice(1, 4).every((x) => x === 0)) return "discard";
  return null;
}

/** Returns a label for a non-public address, or null when it is public. */
export function blockedReason(ip: string): string | null {
  const family = isIP(ip);
  if (family === 4) return blockedV4(ip);
  if (family === 6) return blockedV6(ip);
  return "unparseable";
}

export interface ResolvedTarget {
  host: string;
  port: number;
  /** The single address the connection must use. Pinning defeats DNS rebinding. */
  address: string;
  family: number;
}

/**
 * Resolves a host and checks every returned address. If any address is
 * non-public the host is refused, because a resolver can return a mix
 * and the client might pick the private one.
 */
export async function resolveAndCheck(hostRaw: string, port: number, policy: EgressPolicy): Promise<ResolvedTarget> {
  const host = normalizeHost(hostRaw);
  const key = `${host}:${port}`;
  const allowlisted = policy.privateAllowlist.has(key);
  if (!allowlisted) {
    if (!policy.allowedPorts.has(port)) throw new GuardError("blocked-port", `Port ${port} is not allowed.`);
    if (BLOCKED_NAMES.some((re) => re.test(host))) throw new GuardError("blocked-hostname", `${host} is a local or internal name.`);
  }
  if (isIP(host)) {
    const reason = blockedReason(host);
    if (reason && !allowlisted) throw new GuardError("blocked-address", `${host} is in ${reason} space.`);
    return { host, port, address: host, family: isIP(host) };
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = policy.resolver ? await policy.resolver(host) : await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new GuardError("dns-failure", `The host ${host} could not be found.`);
  }
  if (addrs.length === 0) throw new GuardError("dns-failure", `The host ${host} has no addresses.`);
  if (!allowlisted) {
    for (const a of addrs) {
      const reason = blockedReason(a.address);
      if (reason) throw new GuardError("blocked-address", `${host} resolves to ${reason} space.`);
    }
  }
  const first = addrs[0]!;
  return { host, port, address: first.address, family: first.family };
}

/** Checks a URL hop (initial request or redirect target) end to end. */
export async function checkUrlHop(raw: string, policy: EgressPolicy): Promise<ResolvedTarget> {
  const url = validateUrlSyntax(raw, policy);
  return resolveAndCheck(url.hostname, effectivePort(url), policy);
}
