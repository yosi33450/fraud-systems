import './register-ts-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

process.env.STATE_ENCRYPTION_KEY = 'persistence-unit-test-key-32-characters';
const { encryptPrivateData, decryptPrivateData } = await import('../lib/persistence.server.ts');

test('compressed state round-trips with a smaller encrypted payload', () => {
  const state = { orders: Array.from({ length: 100 }, (_, id) => ({ id, email: 'buyer@example.com' })) };
  const encrypted = encryptPrivateData(state);
  assert.deepEqual(decryptPrivateData(encrypted), state);
  assert.ok(Buffer.byteLength(JSON.stringify(encrypted)) < Buffer.byteLength(JSON.stringify(state)));
});

test('pre-migration uncompressed encrypted state remains readable', () => {
  const state = { version: 1, cases: [{ id: 'existing-case' }] };
  const iv = randomBytes(12);
  const key = createHash('sha256').update(process.env.STATE_ENCRYPTION_KEY).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
  assert.deepEqual(decryptPrivateData({
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64'),
  }), state);
});
