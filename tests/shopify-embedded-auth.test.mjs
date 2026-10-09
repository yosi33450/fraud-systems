import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyShopifyIdToken, embeddedPathAllowed, EMBEDDED_CLIENT_ID, EMBEDDED_SHOP } from '../lib/shopify-embedded-auth.ts';
const secret = 'test-only-not-a-production-secret';
const now = 1800000000;
const claims = { aud: EMBEDDED_CLIENT_ID, dest: `https://${EMBEDDED_SHOP}`, iss: `https://${EMBEDDED_SHOP}/admin`, sub: '123', iat: now - 10, nbf: now - 10, exp: now + 50 };
function sign(overrides = {}, key = secret, alg = 'HS256') {
  const data = [JSON.stringify({alg}), JSON.stringify({...claims,...overrides})].map(v => Buffer.from(v).toString('base64url')).join('.');
  return `${data}.${createHmac('sha256',key).update(data).digest('base64url')}`;
}
test('accepts signed Strongful user token', () => assert.equal(verifyShopifyIdToken(sign(),secret,now)?.tenantId,'tenant-primary'));
for (const [name, overrides] of Object.entries({expired:{exp:now}, future:{nbf:now+1}, audience:{aud:'other'}, shop:{dest:'https://other.myshopify.com'}, issuer:{iss:'https://evil.example/admin'}, user:{sub:''}, missingExpiry:{exp:null}, longLived:{exp:now+3600}})) {
  test(`rejects ${name}`, () => assert.equal(verifyShopifyIdToken(sign(overrides),secret,now),null));
}
test('rejects wrong signature, missing secret and algorithm confusion', () => {
  assert.equal(verifyShopifyIdToken(sign({},'wrong'),secret,now),null);
  assert.equal(verifyShopifyIdToken(sign(),undefined,now),null);
  assert.equal(verifyShopifyIdToken(sign({},secret,'none'),secret,now),null);
  assert.equal(verifyShopifyIdToken('bad',secret,now),null);
});
test('restricts embedded access to primary tenant, not diagnostics or connections', () => {
  assert.equal(embeddedPathAllowed('/api/tenants/tenant-primary/snapshot','GET'),true);
  assert.equal(embeddedPathAllowed('/api/tenants/tenant-other/snapshot','GET'),false);
  assert.equal(embeddedPathAllowed('/api/diagnostics/persistence','GET'),false);
  assert.equal(embeddedPathAllowed('/api/tenants/tenant-primary/stores','POST'),false);
  assert.equal(embeddedPathAllowed('/','GET'),false);
});
