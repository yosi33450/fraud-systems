import { createHmac, timingSafeEqual } from "node:crypto";

// This installation is deliberately bound to Strongful. Other customer installs
// must receive their own tenant mapping before embedded access is enabled.
export const EMBEDDED_CLIENT_ID = "594764d5141fa6d79d1dc989d3064e80";
export const EMBEDDED_SHOP = "strongfulclothing.myshopify.com";
export const EMBEDDED_TENANT = "tenant-primary";

export function verifyShopifyIdToken(token: string, secret: string | undefined, now = Date.now() / 1000) {
  if (!secret || token.length > 8192) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const [headerText, payloadText, signatureText] = parts;
    const header = JSON.parse(Buffer.from(headerText, "base64url").toString());
    if (header.alg !== "HS256" || header.crit) return null;
    const expected = createHmac("sha256", secret).update(`${headerText}.${payloadText}`).digest();
    const actual = Buffer.from(signatureText, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const claims = JSON.parse(Buffer.from(payloadText, "base64url").toString());
    if (claims.aud !== EMBEDDED_CLIENT_ID
      || claims.dest !== `https://${EMBEDDED_SHOP}`
      || claims.iss !== `https://${EMBEDDED_SHOP}/admin`
      || typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now
      || typeof claims.nbf !== "number" || !Number.isFinite(claims.nbf) || claims.nbf > now
      || typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat > now
      || claims.exp - claims.iat > 120
      || typeof claims.sub !== "string" || !/^\d+$/.test(claims.sub)) return null;
    return { shop: EMBEDDED_SHOP, tenantId: EMBEDDED_TENANT, userId: claims.sub };
  } catch { return null; }
}

export function embeddedPathAllowed(path: string, method: string) {
  if (path === "/api/auth/shopify") return method === "GET";
  if (!path.startsWith(`/api/tenants/${EMBEDDED_TENANT}/`)) return false;
  // Store connections are managed outside this single-shop installation.
  if (path === `/api/tenants/${EMBEDDED_TENANT}/stores`) return method === "GET";
  return true;
}
