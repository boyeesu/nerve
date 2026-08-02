import { isIP, type LookupFunction } from "node:net";
import { lookup, type LookupAddress } from "node:dns";
import { resolve4, resolve6 } from "node:dns/promises";

function isPrivateIpv4(value: string): boolean {
  const [a, b] = value.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 0
  );
}

function isLinkLocal(value: string): boolean {
  if (isIP(value) === 4) {
    return value.startsWith("169.254.");
  }
  const normalized = value.toLowerCase();
  return normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb");
}

function isPrivateAddress(value: string): boolean {
  if (isIP(value) === 4) return isPrivateIpv4(value) || isLinkLocal(value);
  if (isIP(value) === 6) {
    const normalized = value.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      isLinkLocal(normalized)
    );
  }
  return false;
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

  const addresses = await resolvedAddresses(url.hostname);
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
