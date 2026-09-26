import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import nextEnv from '@next/env';
import '../tests/register-ts-alias.mjs';

nextEnv.loadEnvConfig(process.cwd());
const { encryptPrivateData, decryptPrivateData } = await import('../lib/persistence.server.ts');

export async function importBackup(sourcePath, key) {
  if (!sourcePath) throw new Error('SOURCE_PATH_REQUIRED');
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  if (!url || !key) throw new Error('SUPABASE_SERVER_CREDENTIALS_MISSING');

  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  const state = decryptPrivateData(source);
  if (state.version !== 1 || !Array.isArray(state.orders) || !Array.isArray(state.cases) || !Array.isArray(state.storeConnections)) {
    throw new Error('INVALID_BACKUP_STATE');
  }
  const digest = createHash('sha256').update(JSON.stringify(state)).digest('hex');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const endpoint = `${url}/rest/v1/shield_ledger_state`;

  const existing = await fetch(`${endpoint}?id=eq.global&select=id&limit=1`, { headers, cache: 'no-store' });
  if (!existing.ok) throw new Error(`SUPABASE_READ_FAILED_${existing.status}`);
  if ((await existing.json()).length) throw new Error('TARGET_ALREADY_HAS_STATE');

  const payload = encryptPrivateData(state);
  const inserted = await fetch(endpoint, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ id: 'global', ...payload, updated_at: new Date().toISOString() }),
  });
  if (!inserted.ok) throw new Error(`SUPABASE_INSERT_FAILED_${inserted.status}`);

  const response = await fetch(`${endpoint}?id=eq.global&select=ciphertext,iv,auth_tag&limit=1`, { headers, cache: 'no-store' });
  if (!response.ok) throw new Error(`SUPABASE_VERIFY_READ_FAILED_${response.status}`);
  const [saved] = await response.json();
  if (!saved) throw new Error('SUPABASE_VERIFY_EMPTY');
  const verified = decryptPrivateData(saved);
  const savedDigest = createHash('sha256').update(JSON.stringify(verified)).digest('hex');
  if (savedDigest !== digest) throw new Error('SUPABASE_VERIFY_MISMATCH');

  return {
    imported: true,
    encryptedBytes: Buffer.byteLength(JSON.stringify(payload)),
    orders: verified.orders.length,
    cases: verified.cases.length,
    stores: verified.stores.length,
    rules: verified.rulesByTenant?.reduce((sum, [, rules]) => sum + rules.length, 0) ?? 0,
    storeConnections: verified.storeConnections.length,
    digest,
  };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/import-backup-to-supabase.mjs')) {
  importBackup(process.argv[2], process.env.SUPABASE_SERVICE_ROLE_KEY).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; },
  );
}
