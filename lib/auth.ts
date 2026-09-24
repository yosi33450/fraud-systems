const encoder = new TextEncoder();

export const AUTH_COOKIE = "shield_session";
export const SESSION_SECONDS = 60 * 60 * 12;

const bytesToHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

async function signature(expiresAt: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, encoder.encode(expiresAt)));
}

export async function createSessionToken(secret: string) {
  const expiresAt = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  return `${expiresAt}.${await signature(expiresAt, secret)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string | undefined) {
  if (!token || !secret) return false;
  const [expiresAt, suppliedSignature] = token.split(".");
  if (!expiresAt || !suppliedSignature || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return false;
  const expectedSignature = await signature(expiresAt, secret);
  if (expectedSignature.length !== suppliedSignature.length) return false;
  let difference = 0;
  for (let index = 0; index < expectedSignature.length; index += 1) {
    difference |= expectedSignature.charCodeAt(index) ^ suppliedSignature.charCodeAt(index);
  }
  return difference === 0;
}
