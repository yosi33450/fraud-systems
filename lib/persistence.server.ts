import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, put } from "@vercel/blob";
import { exportOperationalState, restoreOperationalState, type PersistedOperationalState } from "@/lib/operational-store";

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
}

const encryptionKey = () => {
  const secret = process.env.STATE_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("STATE_ENCRYPTION_KEY_MISSING");
  return createHash("sha256").update(secret).digest();
};

const encrypt = (snapshot: PersistedOperationalState): EncryptedState => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(snapshot), "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
  };
};

const decrypt = (payload: EncryptedState): PersistedOperationalState => {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.auth_tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as PersistedOperationalState;
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

async function loadEncryptedState(): Promise<EncryptedState | null> {
  if (blobConfigured()) {
    const result = await get(blobPath, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return JSON.parse(await new Response(result.stream).text()) as EncryptedState;
  }
  const supabase = supabaseConfiguration();
  if (supabase) {
    const response = await fetch(`${supabase.url}/rest/v1/shield_ledger_state?id=eq.${stateId}&select=ciphertext,iv,auth_tag&limit=1`, {
      headers: supabaseHeaders(supabase),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`PERSISTENCE_READ_FAILED_${response.status}`);
    const rows = await response.json() as EncryptedState[];
    return rows[0] ?? null;
  }
  if (process.env.VERCEL) throw new Error("PERSISTENCE_NOT_CONFIGURED");
  try {
    return JSON.parse(await readFile(localFile, "utf8")) as EncryptedState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function saveEncryptedState(payload: EncryptedState) {
  if (blobConfigured()) {
    await put(blobPath, JSON.stringify(payload), {
      access: "private",
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
    return;
  }
  const supabase = supabaseConfiguration();
  if (supabase) {
    const response = await fetch(`${supabase.url}/rest/v1/shield_ledger_state`, {
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
  if (process.env.VERCEL) throw new Error("PERSISTENCE_NOT_CONFIGURED");
  await mkdir(localDirectory, { recursive: true });
  await writeFile(temporaryFile, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryFile, localFile);
}

export async function hydrateOperationalState() {
  globalThis.__shieldLedgerHydration ??= (async () => {
    const payload = await loadEncryptedState();
    if (payload) restoreOperationalState(decrypt(payload));
  })();
  return globalThis.__shieldLedgerHydration;
}

export async function persistOperationalState() {
  const persist = async () => saveEncryptedState(encrypt(exportOperationalState()));
  globalThis.__shieldLedgerPersistenceQueue = (globalThis.__shieldLedgerPersistenceQueue ?? Promise.resolve()).then(persist, persist);
  return globalThis.__shieldLedgerPersistenceQueue;
}
