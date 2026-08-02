import {
  createCipheriv,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";

const ENVELOPE_VERSION = "v1";

function encryptionKey(): Buffer {
  const raw = process.env.NERVE_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("NERVE_ENCRYPTION_KEY is required.");
  }

  const candidates: Buffer[] = [
    Buffer.from(raw, "base64url"),
    Buffer.from(raw, "base64"),
  ];
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    candidates.unshift(Buffer.from(raw, "hex"));
  }

  const key = candidates.find((candidate) => candidate.length === 32);
  if (!key) {
    throw new Error("NERVE_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

export function encryptionConfigured(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptJson(value: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptJson<T extends Record<string, unknown>>(envelope: string): T {
  const [version, ivEncoded, ciphertextEncoded, tagEncoded] = envelope.split(".");
  if (
    version !== ENVELOPE_VERSION ||
    !ivEncoded ||
    !ciphertextEncoded ||
    !tagEncoded
  ) {
    throw new Error("Encrypted credential envelope is invalid.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export type OpenClawDeviceIdentity = {
  deviceId: string;
  publicKey: string;
  privateKeyPem: string;
};

export function createOpenClawDeviceIdentity(): OpenClawDeviceIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  const rawPublicKey = der.subarray(-32);
  return {
    deviceId: createHash("sha256").update(rawPublicKey).digest("hex"),
    publicKey: rawPublicKey.toString("base64url"),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function signOpenClawDevicePayload(
  privateKeyPem: string,
  payload: string,
): string {
  return sign(null, Buffer.from(payload, "utf8"), privateKeyPem).toString("base64url");
}
