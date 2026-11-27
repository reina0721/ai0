import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export class WebSsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSsrfBlockedError";
  }
}

export type DnsLookupFn = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

function parseIpv4Octets(ip: string): [number, number, number, number] | undefined {
  const parts = ip.split(".");
  if (parts.length !== 4) return undefined;
  const nums = parts.map((p) => (/^\d+$/u.test(p) ? Number(p) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return undefined;
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

function isBlockedIpv4(octets: [number, number, number, number]): boolean {
  const [a, b, c] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24, TEST-NET-1
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast & reserved/broadcast
  return false;
}

export function isBlockedIpAddress(rawAddress: string): boolean {
  const clean = rawAddress.trim().replace(/^\[|\]$/gu, "").split("%")[0]!.toLowerCase();
  const family = isIP(clean);
  if (family === 4) {
    const octets = parseIpv4Octets(clean);
    return !octets || isBlockedIpv4(octets);
  }
  if (family !== 6) {
    return true;
  }

  if (clean === "::" || clean === "::1") return true;
  if (clean.startsWith("fe8") || clean.startsWith("fe9") || clean.startsWith("fea") || clean.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (clean.startsWith("fc") || clean.startsWith("fd")) {
    return true; // fc00::/7 unique local
  }
  if (clean.startsWith("ff")) {
    return true; // ff00::/8 multicast
  }
  if (clean.startsWith("2001:db8:") || clean === "2001:db8") {
    return true; // documentation
  }

  // IPv4-mapped IPv6 in dotted form (::ffff:127.0.0.1) or hex form (::ffff:7f00:1)
  if (clean.startsWith("::ffff:")) {
    const tail = clean.slice("::ffff:".length);
    const dotted = parseIpv4Octets(tail);
    if (dotted) return isBlockedIpv4(dotted);
    const hexParts = tail.split(":");
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0]!, 16);
      const lo = parseInt(hexParts[1]!, 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return isBlockedIpv4([(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]);
      }
    }
    return true;
  }

  return false;
}

const defaultDnsLookup: DnsLookupFn = async (hostname: string) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export async function assertSafePublicUrl(
  rawUrl: string,
  lookupFn: DnsLookupFn = defaultDnsLookup
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new WebSsrfBlockedError(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebSsrfBlockedError(`Unsupported URL protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new WebSsrfBlockedError("Credentials in URL are forbidden");
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    throw new WebSsrfBlockedError(`Blocked internal hostname: ${hostname}`);
  }

  if (isIP(hostname) !== 0) {
    if (isBlockedIpAddress(hostname)) {
      throw new WebSsrfBlockedError(`Blocked private or loopback IP literal: ${hostname}`);
    }
    return parsed;
  }

  const resolved = await lookupFn(hostname);
  if (!resolved.length) {
    throw new WebSsrfBlockedError(`DNS resolution returned no addresses for ${hostname}`);
  }
  for (const record of resolved) {
    if (isBlockedIpAddress(record.address)) {
      throw new WebSsrfBlockedError(`Blocked SSRF target ${hostname} -> ${record.address}`);
    }
  }
  return parsed;
}
