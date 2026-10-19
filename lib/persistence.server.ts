import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { get, put } from "@vercel/blob";
import { exportOperationalState, restoreOperationalState, type PersistedOperationalState } from "@/lib/operational-store";
import { mergeStateChanges } from "@/lib/state-merge";

type EncryptedState = {
  ciphertext: string;
  iv: string;
  auth_tag: string;
};

const stateId = "global";
const localDirectory = path.join(process.cwd(), ".data");
const localFile = path.join(localDirectory, "shield-ledger-state.enc.json");
const temporaryFile = path.join(localDirectory, "shield-ledger-state.enc.tmp");
const blobPath = "private/shield-ledger-state.enc.json";

declare global {
  // eslint-disable-next-line no-var
  var __shieldLedgerHydration: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __shieldLedgerPersistenceQueue: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __shieldLedgerLastHydratedAt: number | undefined;
  // The baseline belongs to this instance, not to other concurrent writers.
  var __shieldLedgerBaseline: PersistedOperationalState | undefined;
  var __shieldLedgerRevision: string | undefined;
  var __shieldLedgerBackupDay: string | undefined;
}

// The dashboard asks for a fresh snapshot in the background.  Keep a warm
// server instance from downloading the complete encrypted state on each of
// those checks; writes update this timestamp immediately below.
const refreshIntervalMs = 15 * 1000;

const encryptionKey = () => {
  const secret = process.env.STATE_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("STATE_ENCRYPTION_KEY_MISSING");
  return createHash("sha256").update(secret).digest();
};

export const encryptPrivateData = (snapshot: unknown): EncryptedState => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(gzipSync(JSON.stringify(snapshot))), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
  };
};

export const decryptPrivateData = <T = PersistedOperationalState,>(payload: EncryptedState): T => {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.auth_tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  const content = plaintext[0] === 0x1f && plaintext[1] === 0x8b ? gunzipSync(plaintext) : plaintext;
  return JSON.parse(content.toString("utf8")) as T;
};

const supabaseConfiguration = () => {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const persistenceApiKey = process.env.PERSISTENCE_API_KEY;
  if (url && serviceRoleKey) return { url, apiKey: serviceRoleKey, authorization: serviceRoleKey, persistenceApiKey: undefined };
  if (url && publishableKey && persistenceApiKey) return { url, apiKey: publishableKey, authorization: publishableKey, persistenceApiKey };
  return null;
};

const supabaseHeaders = (configuration: NonNullable<ReturnType<typeof supabaseConfiguration>>) => ({
  apikey: configuration.apiKey,
  Authorization: `Bearer ${configuration.authorization}`,
  "Content-Type": "application/json",
  ...(configuration.persistenceApiKey ? { "x-shield-key": configuration.persistenceApiKey } : {}),
});

const blobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

// Do not let a temporarily slow database turn the whole dashboard into an
// endless loading screen. The browser can retry on its next background refresh.
// Reads contain the encrypted tenant snapshot and may take longer than a small
// REST query immediately after a cold deployment. Keep this below the browser
// refresh deadline, but do not make a healthy store appear disconnected.
async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function loadBlobState(): Promise<EncryptedState | null> {
  const result = await get(blobPath, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return JSON.parse(await new Response(result.stream).text()) as EncryptedState;
}

async function waitForPendingWrite() {
  const pending = globalThis.__shieldLedgerPersistenceQueue;
  if (!pending) return;
  await pending;
}

type PersistenceBackend = "blob" | "supabase" | "local";

function persistenceBackend(): PersistenceBackend {
  const selected = process.env.PERSISTENCE_BACKEND;
  if (selected === "supabase") {
    if (!supabaseConfiguration()) throw new Error("SUPABASE_PERSISTENCE_NOT_CONFIGURED");
    return "supabase";
  }
  if (selected === "blob") {
    if (!blobConfigured()) throw new Error("BLOB_PERSISTENCE_NOT_CONFIGURED");
    return "blob";
  }
  if (selected === "local") {
    if (process.env.VERCEL) throw new Error("LOCAL_PERSISTENCE_NOT_ALLOWED_ON_VERCEL");
    return "local";
  }
  if (selected) throw new Error("INVALID_PERSISTENCE_BACKEND");

  // Preserve existing deployments until a verified, explicit cutover is made.
  if (blobConfigured()) return "blob";
  if (supabaseConfiguration()) return "supabase";
  if (process.env.VERCEL) throw new Error("PERSISTENCE_NOT_CONFIGURED");
  return "local";
}

async function loadEncryptedState(): Promise<EncryptedState | null> {
  const backend = persistenceBackend();
  if (backend === "blob") {
    return loadBlobState();
  }
  if (backend === "supabase") {
    const supabase = supabaseConfiguration()!;
      const response = await fetchWithTimeout(`${supabase.url}/rest/v1/shield_ledger_state?id=eq.${stateId}&select=ciphertext,iv,auth_tag&limit=1`, {
        headers: supabaseHeaders(supabase),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`PERSISTENCE_READ_FAILED_${response.status}`);
      const rows = await response.json() as EncryptedState[];
      return rows[0] ?? null;
  }
  try {
    return JSON.parse(await readFile(localFile, "utf8")) as EncryptedState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function saveEncryptedState(payload: EncryptedState) {
  const backend = persistenceBackend();
  if (backend === "blob") {
    await put(blobPath, JSON.stringify(payload), {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
    return;
  }
  if (backend === "supabase") {
    const supabase = supabaseConfiguration()!;
    const response = await fetchWithTimeout(`${supabase.url}/rest/v1/shield_ledger_state`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(supabase),
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ id: stateId, ...payload, updated_at: new Date().toISOString() }),
    });
    if (!response.ok) throw new Error(`PERSISTENCE_WRITE_FAILED_${response.status}`);
    return;
  }
  await mkdir(localDirectory, { recursive: true });
  await writeFile(temporaryFile, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryFile, localFile);
}

async function preserveDailyRecoveryCopy(payload: EncryptedState) {
  const day = new Date().toISOString().slice(0, 10);
  if (globalThis.__shieldLedgerBackupDay === day) return;
  const config = supabaseConfiguration()!;
  const slot = Math.floor(Date.now() / 86400000) % 7;
  const id = `recovery-global-${slot}`;
  const endpoint = `${config.url}/rest/v1/shield_ledger_state`;
  const check = await fetchWithTimeout(`${endpoint}?id=eq.${id}&select=iv,updated_at`,{headers:supabaseHeaders(config),cache:"no-store"});
  if (!check.ok) throw new Error(`PERSISTENCE_BACKUP_READ_FAILED_${check.status}`);
  const row = (await check.json() as Array<{iv:string;updated_at:string}>)[0];
  if (!row || row.updated_at.slice(0,10) !== day) {
    const response = await fetchWithTimeout(row ? `${endpoint}?id=eq.${id}&iv=eq.${encodeURIComponent(row.iv)}` : endpoint, {
      method: row ? "PATCH" : "POST", headers:{...supabaseHeaders(config),Prefer:"return=minimal"},
      body:JSON.stringify({id,...payload,updated_at:new Date().toISOString()}),
    });
    if (!response.ok && response.status !== 409) throw new Error(`PERSISTENCE_BACKUP_WRITE_FAILED_${response.status}`);
  }
  globalThis.__shieldLedgerBackupDay = day;
}

export async function hydrateOperationalState(options: { refresh?: boolean; force?: boolean } = {}) {
  const isFresh = Boolean(globalThis.__shieldLedgerLastHydratedAt)
    && Date.now() - globalThis.__shieldLedgerLastHydratedAt! < refreshIntervalMs;
  if (options.refresh && (options.force || !isFresh)) {
    // A Vercel deployment can have several warm function instances. Their
    // in-memory snapshots must not hide newer writes made by another instance.
    await waitForPendingWrite();
    if (!options.force && persistenceBackend() === "supabase" && globalThis.__shieldLedgerRevision) {
      const config = supabaseConfiguration()!;
      const response = await fetchWithTimeout(`${config.url}/rest/v1/shield_ledger_state?id=eq.${stateId}&select=iv&limit=1`, {headers:supabaseHeaders(config),cache:"no-store"});
      if (!response.ok) throw new Error(`PERSISTENCE_READ_FAILED_${response.status}`);
      const rows = await response.json() as Array<{iv:string}>;
      if (rows[0]?.iv === globalThis.__shieldLedgerRevision) {
        globalThis.__shieldLedgerLastHydratedAt = Date.now();
        return;
      }
    }
    const before = exportOperationalState();
    const payload = await loadEncryptedState();
    if (JSON.stringify(before) !== JSON.stringify(exportOperationalState())) return;
    if (payload) {
      const remote = decryptPrivateData(payload);
      restoreOperationalState(globalThis.__shieldLedgerBaseline ? mergeStateChanges(globalThis.__shieldLedgerBaseline, before, remote) : remote);
      globalThis.__shieldLedgerBaseline = remote;
      globalThis.__shieldLedgerRevision = payload.iv;
    }
    globalThis.__shieldLedgerHydration = Promise.resolve();
    globalThis.__shieldLedgerLastHydratedAt = Date.now();
    return;
  }
  if (!globalThis.__shieldLedgerHydration) {
    const hydration = (async () => {
    const payload = await loadEncryptedState();
    if (payload) restoreOperationalState(decryptPrivateData(payload));
    globalThis.__shieldLedgerBaseline = exportOperationalState();
    globalThis.__shieldLedgerRevision = payload?.iv;
    globalThis.__shieldLedgerLastHydratedAt = Date.now();
    })();
    // A short database outage must not poison a warm serverless instance forever.
    // Reset the cached promise on failure so the next request can recover normally.
    globalThis.__shieldLedgerHydration = hydration.catch((error) => {
      globalThis.__shieldLedgerHydration = undefined;
      throw error;
    });
  }
  return globalThis.__shieldLedgerHydration;
}

// Admin-only recovery inspection. Encrypted exports never expose connection tokens.
export async function inspectRecoveryState() {
  const sources: Array<{source: string; payload: EncryptedState; summary: unknown}> = [];
  const add = (source: string, payload: EncryptedState) => {
    try {
      const s = decryptPrivateData(payload);
      sources.push({source, payload, summary: {employees: s.employees, cases: s.cases?.length, orders: s.orders?.length,
        latestOrder: s.orders?.reduce((latest, order) => order.createdAt > latest ? order.createdAt : latest, ""),
        targets: s.cases?.filter(c => ["558020", "558026", "558034"].includes(String(c.orderNumber)))}});
    } catch { sources.push({source, payload, summary: {decryptable: false}}); }
  };
  const current = await loadEncryptedState();
  if (current) add("active", current);
  if (blobConfigured() && persistenceBackend() !== "blob") {
    try { const blob = await loadBlobState(); if (blob) add("legacy-blob", blob); } catch { /* optional recovery source */ }
  }
  return {backend: persistenceBackend(), sources};
}

export async function persistOperationalState() {
  const persist = async () => {
    const local = exportOperationalState();
    const base = globalThis.__shieldLedgerBaseline;
    if (!base) throw new Error("PERSISTENCE_HYDRATION_REQUIRED");
    if (persistenceBackend() !== "supabase") {
      await saveEncryptedState(encryptPrivateData(local));
      globalThis.__shieldLedgerBaseline = local;
      return;
    }
    const supabase = supabaseConfiguration()!;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 100 + Math.floor(Math.random() * Math.min(1200, 150 * 2 ** attempt))));
      const current = await loadEncryptedState();
      // Never recreate a missing production row from a warm/empty snapshot.
      if (!current) throw new Error("PERSISTENCE_STATE_MISSING");
      await preserveDailyRecoveryCopy(current);
      const merged = mergeStateChanges(base, local, decryptPrivateData(current));
      const payload = encryptPrivateData(merged);
      const response = await fetchWithTimeout(`${supabase.url}/rest/v1/shield_ledger_state?id=eq.${stateId}&iv=eq.${encodeURIComponent(current.iv)}&select=id`, {
        method: "PATCH",
        headers: { ...supabaseHeaders(supabase), Prefer: "return=representation" },
        body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() }),
      });
      if (!response.ok) throw new Error(`PERSISTENCE_WRITE_FAILED_${response.status}`);
      const rows = await response.json() as EncryptedState[];
      if (rows.length === 1) {
        // Do not replace in-flight requests' local changes with the remote state.
        globalThis.__shieldLedgerBaseline = local;
        // A local snapshot may not contain other instances' merged records.
        // Force the next read to compare/load the durable version.
        globalThis.__shieldLedgerRevision = undefined;
        return;
      }
    }
    throw new Error("PERSISTENCE_CONCURRENT_WRITE_RETRY");
  };
  globalThis.__shieldLedgerPersistenceQueue = (globalThis.__shieldLedgerPersistenceQueue ?? Promise.resolve()).then(persist, persist);
  await globalThis.__shieldLedgerPersistenceQueue;
  globalThis.__shieldLedgerLastHydratedAt = Date.now();
}
