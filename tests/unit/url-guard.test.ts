import { describe, expect, it } from "vitest";
import { blockedReason, checkUrlHop, expandV6, GuardError, resolveAndCheck, validateUrlSyntax, type EgressPolicy } from "@/lib/security/url-guard";

const policy = (resolve: Record<string, string[]> = {}, allow: string[] = []): EgressPolicy => ({
  allowedPorts: new Set([80, 443, 8080, 8443]),
  privateAllowlist: new Set(allow),
  resolver: async (host) => {
    const addrs = resolve[host];
    if (!addrs) throw new Error("ENOTFOUND");
    return addrs.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  },
});

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof GuardError ? e.code : "other";
  }
  return "ok";
};

describe("validateUrlSyntax", () => {
  const p = policy();
  it.each([
    ["https://example.org/page", "ok"],
    ["http://example.org", "ok"],
    ["https://example.org:8443/x", "ok"],
    ["ftp://example.org", "unsupported-scheme"],
    ["file:///etc/passwd", "unsupported-scheme"],
    ["javascript:alert(1)", "unsupported-scheme"],
    ["data:text/html,hi", "unsupported-scheme"],
    ["https://user:pass@example.org", "credentials-in-url"],
    ["https://user@example.org", "credentials-in-url"],
    ["https://example.org:22", "blocked-port"],
    ["http://localhost:8080", "blocked-hostname"],
    ["http://app.localhost", "blocked-hostname"],
    ["http://printer.local", "blocked-hostname"],
    ["http://metadata.google.internal", "blocked-hostname"],
    ["http://127.0.0.1", "blocked-address"],
    ["http://2130706433", "blocked-address"], // decimal form of 127.0.0.1
    ["http://0177.0.0.1", "blocked-address"], // octal form
    ["http://0x7f.1", "blocked-address"],
    ["http://169.254.169.254/latest/meta-data", "blocked-address"],
    ["http://10.0.0.5", "blocked-address"],
    ["http://[::1]", "blocked-address"],
    ["http://[::ffff:127.0.0.1]", "blocked-address"],
    ["http://[fd00::1]", "blocked-address"],
    ["not a url", "invalid-url"],
    [`https://example.org/${"a".repeat(2100)}`, "invalid-url"],
  ])("%s -> %s", (input, expected) => {
    expect(code(() => validateUrlSyntax(input, p))).toBe(expected);
  });

  it("allows an explicitly allowlisted private host and port only", () => {
    const allow = policy({}, ["127.0.0.1:4100"]);
    expect(code(() => validateUrlSyntax("http://127.0.0.1:4100/", allow))).toBe("ok");
    expect(code(() => validateUrlSyntax("http://127.0.0.1:4101/", allow))).toBe("blocked-address");
  });
});

describe("IP classification", () => {
  it.each([
    ["8.8.8.8", null],
    ["1.1.1.1", null],
    ["2606:4700:4700::1111", null],
    ["0.0.0.0", "unspecified"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["172.32.0.1", null],
    ["192.168.1.1", "private"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["169.254.169.254", "link-local"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "reserved"],
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["fe80::1%eth0", "link-local"],
    ["fc00::1", "unique local (private)"],
    ["::ffff:10.0.0.1", "private"],
    ["64:ff9b::7f00:1", "loopback"],
    ["2002:7f00:1::", "loopback"],
    ["2001:0:4136:e378::", "Teredo tunnel"],
    ["2001:db8::1", "documentation"],
  ])("%s", (ip, expected) => {
    expect(blockedReason(ip)).toBe(expected);
  });

  it("expands IPv6 forms", () => {
    expect(expandV6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(expandV6("1::2")).toEqual([1, 0, 0, 0, 0, 0, 0, 2]);
    expect(expandV6("1:2:3")).toBeNull();
  });
});

describe("DNS resolution checks", () => {
  it("accepts a host that resolves only to public addresses and pins the address", async () => {
    const t = await resolveAndCheck("example.org", 443, policy({ "example.org": ["93.184.215.14"] }));
    expect(t.address).toBe("93.184.215.14");
  });

  it("refuses a host if any resolved address is private (rebinding and mixed answers)", async () => {
    await expect(resolveAndCheck("evil.test.example", 443, policy({ "evil.test.example": ["93.184.215.14", "127.0.0.1"] }))).rejects.toMatchObject({ code: "blocked-address" });
    await expect(resolveAndCheck("rebind.example", 443, policy({ "rebind.example": ["169.254.169.254"] }))).rejects.toMatchObject({ code: "blocked-address" });
  });

  it("refuses names that do not resolve", async () => {
    await expect(resolveAndCheck("nope.example", 443, policy())).rejects.toMatchObject({ code: "dns-failure" });
  });

  it("checks each redirect hop with the same rules", async () => {
    const p = policy({ "site.example": ["93.184.215.14"], "internal.example": ["10.0.0.8"] });
    await expect(checkUrlHop("https://site.example/a", p)).resolves.toMatchObject({ host: "site.example" });
    await expect(checkUrlHop("http://internal.example/admin", p)).rejects.toMatchObject({ code: "blocked-address" });
    await expect(checkUrlHop("http://169.254.169.254/", p)).rejects.toBeInstanceOf(GuardError);
  });
});
