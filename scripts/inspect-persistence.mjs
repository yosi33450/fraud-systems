import { createDecipheriv, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { get } from "@vercel/blob";
import nextEnv from "@next/env";
import { gunzipSync, gzipSync } from "node:zlib";

nextEnv.loadEnvConfig(process.cwd());

const path = process.argv[2];
const source = path ?? "private/shield-ledger-state.enc.json";

function summary(text) {
  const encrypted = JSON.parse(text);
  const key = process.env.STATE_ENCRYPTION_KEY;
  if (!key) throw new Error("STATE_ENCRYPTION_KEY_MISSING");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(key).digest(),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.auth_tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]);
  const decoded = plaintext[0] === 0x1f && plaintext[1] === 0x8b ? gunzipSync(plaintext) : plaintext;
  const state = JSON.parse(decoded.toString("utf8"));
  return {
    bytes: Buffer.byteLength(text),
    compressedPlaintextBytes: gzipSync(decoded).byteLength,
    sha256: createHash("sha256").update(text).digest("hex"),
    stores: state.stores?.length ?? 0,
    orders: state.orders?.length ?? 0,
    cases: state.cases?.length ?? 0,
    giftCards: state.giftCards?.length ?? 0,
    giftCardOrders: state.giftCardOrders?.length ?? 0,
    employees: state.employees?.length ?? 0,
    rules: state.rulesByTenant?.reduce((total, [, rules]) => total + rules.length, 0) ?? 0,
    deliveries: state.deliveries?.length ?? 0,
    audit: state.audit?.length ?? 0,
    storeConnections: state.storeConnections?.length ?? 0,
    latestOrderAt: state.orders?.reduce((latest, order) => order.createdAt > latest ? order.createdAt : latest, "") ?? "",
  };
}

try {
  let text;
  if (path) {
    text = await readFile(path, "utf8");
  } else {
    const result = await get(source, { access: "private", useCache: false });
    if (!result?.stream || result.statusCode !== 200) throw new Error(`BLOB_STATUS_${result?.statusCode ?? "NOT_FOUND"}`);
    text = await new Response(result.stream).text();
  }
  console.log(JSON.stringify({ source: path ? "file" : "blob", ...summary(text) }));
} catch (error) {
  console.error(JSON.stringify({ source: path ? "file" : "blob", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
