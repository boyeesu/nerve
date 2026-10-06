import { BlockList, isIP, type LookupFunction } from "node:net";
import { lookup, type LookupAddress } from "node:dns";
import { resolve4, resolve6 } from "node:dns/promises";

// BlockList also recognizes IPv4-mapped IPv6 addresses.
const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["127.0.0.0", 8],
  ["172.16.0.0", 12], ["192.168.0.0", 16], ["100.64.0.0", 10],
] as const) privateAddresses.addSubnet(address, prefix, "ipv4");
privateAddresses.addAddress("::", "ipv6");
privateAddresses.addAddress("::1", "ipv6");
privateAddresses.addSubnet("fc00::", 7, "ipv6");

const linkLocalAddresses = new BlockList();
linkLocalAddresses.addSubnet("169.254.0.0", 16, "ipv4");
linkLocalAddresses.addSubnet("fe80::", 10, "ipv6");

function inBlockList(list: BlockList, address: string): boolean {
  const family = isIP(address);
  return family !== 0 && list.check(address, family === 4 ? "ipv4" : "ipv6");
}

function isLinkLocal(value: string): boolean {
  return inBlockList(linkLocalAddresses, value);
}

function isPrivateAddress(value: string): boolean {
  return inBlockList(privateAddresses, value) || isLinkLocal(value);
}

function addressAllowed(address: string): boolean {
  if (isLinkLocal(address)) return false;
  return process.env.NERVE_ALLOW_PRIVATE_NETWORKS === "true" || !isPrivateAddress(address);
}

async function resolvedAddresses(hostname: string): Promise<string[]> {
  if (isIP(hostname)) return [hostname];
  const [v4, v6] = await Promise.all([
    resolve4(hostname).catch(() => []),
    resolve6(hostname).catch(() => []),
  ]);
  return [...v4, ...v6];
}

export async function assertSafeRuntimeEndpoint(
  rawEndpoint: string,
  runtime: "openclaw" | "hermes",
): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawEndpoint);
  } catch {
    throw new Error("Enter a valid absolute runtime URL.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Runtime URLs cannot contain credentials, query strings, or fragments.");
  }

  const allowedProtocols =
    runtime === "openclaw" ? new Set(["wss:", "ws:", "https:", "http:"]) : new Set(["https:", "http:"]);
  if (!allowedProtocols.has(url.protocol)) {
    throw new Error(runtime === "openclaw" ? "OpenClaw requires a WebSocket URL." : "Hermes requires an HTTP URL.");
  }

  const allowPrivate = process.env.NERVE_ALLOW_PRIVATE_NETWORKS === "true";
  const insecure = url.protocol === "http:" || url.protocol === "ws:";
  if (insecure && !allowPrivate) {
    throw new Error("Plaintext runtime connections are disabled. Use TLS or explicitly allow private networks.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await resolvedAddresses(hostname);
  if (addresses.length === 0) {
    throw new Error("The runtime hostname could not be resolved.");
  }
  if (addresses.some(isLinkLocal)) {
    throw new Error("Link-local and cloud metadata addresses are always blocked.");
  }
  if (!allowPrivate && addresses.some(isPrivateAddress)) {
    throw new Error("Private runtime addresses are disabled on this Nerve deployment.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (runtime === "openclaw") {
    if (url.protocol === "https:") url.protocol = "wss:";
    if (url.protocol === "http:") url.protocol = "ws:";
  } else if (url.pathname.endsWith("/v1")) {
    url.pathname = url.pathname.slice(0, -3) || "/";
  }
  return url.toString().replace(/\/$/, "");
}

export const safeRuntimeLookup: LookupFunction = (hostname, options, callback) => {
  const normalizedOptions =
    typeof options === "number"
      ? { family: options, all: false }
      : { ...options, all: true };
  lookup(hostname, normalizedOptions, (error, results) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    const addresses: LookupAddress[] = Array.isArray(results)
      ? results
      : [
          typeof results === "string"
            ? { address: results, family: typeof options === "number" ? options : 0 }
            : results,
        ];
    const allowed = addresses.filter((result) => addressAllowed(result.address));
    if (allowed.length === 0) {
      callback(new Error("Runtime address was blocked by Nerve network policy."), "", 0);
      return;
    }
    if (typeof options === "object" && options.all) {
      (
        callback as unknown as (
          error: NodeJS.ErrnoException | null,
          addresses: LookupAddress[],
        ) => void
      )(null, allowed);
      return;
    }
    callback(null, allowed[0].address, allowed[0].family);
  });
};
