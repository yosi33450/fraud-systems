import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGiftLedger, hasFlaggedGiftSource, extractGiftUses, extractIssuances, normalizeGiftCardId, receiptGiftCard } from '../lib/gift-card-evidence.ts';

const event = (id = '12345', suffix = 'AB12') => ({ id: 'gid://shopify/BasicEvent/1', action: 'fulfillment_success', createdAt: '2026-09-01T12:00:00Z', additionalContent: JSON.stringify({ content: [{ content: `<a href="/admin/gift_cards/${id}">•••• •••• •••• ${suffix}</a>` }] }) });
const transaction = (overrides = {}) => ({ id: 'tx1', gateway: 'gift_card', kind: 'SALE', status: 'SUCCESS', processedAt: '2026-09-02T12:00:00Z', receiptJson: JSON.stringify({ gift_card_id: 12345, gift_card_last_characters: 'ab12' }), amountSet: { shopMoney: { amount: '100.25', currencyCode: 'ILS' } }, ...overrides });
const order = (overrides = {}) => ({ tenantId: 'test-tenant', storeId: 'test-store', orderId: 'o1', orderNumber: '#1001', customer: 'Test buyer', email: 'buyer@example.com', createdAt: '2026-09-01T12:00:00Z', checkedAt: '2026-09-03T12:00:00Z', giftCardUnits: 1, issued: [], uses: [], unidentifiedTransactions: 0, complete: true, ...overrides });

test('extracts exact issuance from nested Shopify JSON and deduplicates events', () => {
  const issued = extractIssuances([event(), event()]);
  assert.equal(issued.length, 1); assert.equal(issued[0].giftCardId, 'gid://shopify/GiftCard/12345');
  assert.equal(issued[0].lastCharacters, 'AB12'); assert.ok(issued[0].eventId);
});
test('never treats arbitrary text, four characters or unrelated events as a card ID', () => {
  assert.equal(normalizeGiftCardId('random12345'), undefined);
  assert.equal(normalizeGiftCardId(Number.MAX_SAFE_INTEGER + 1), undefined);
  assert.equal(extractIssuances([{ ...event(), action: 'comment' }]).length, 0);
  assert.equal(receiptGiftCard({ authorization: '12345', last_four: 'AB12' }).id, undefined);
  assert.equal(receiptGiftCard({ gift_card_id: 12345, nested: { gift_card_id: 99999 } }).id, undefined);
});
test('decodes escaped HTML inside the deeply nested Shopify text component', () => {
  let content = String.raw`\u003ca href=\"\/admin\/gift_cards\/12345\"\u003e•••• •••• •••• AB12\u003c\/a\u003e`;
  for (let index = 0; index < 9; index++) content = { content: [content] };
  assert.equal(extractIssuances([{ ...event(), additionalContent: JSON.stringify(content) }])[0].giftCardId, 'gid://shopify/GiftCard/12345');
});
test('malformed receipts and nested content do not crash or invent links', () => {
  assert.equal(receiptGiftCard('{broken').id, undefined);
  assert.equal(extractIssuances([{ ...event(), additionalContent: '{broken' }]).length, 0);
  assert.equal(extractIssuances([{ ...event(), additionalContent: '<a href="https://untrusted.example/gift_cards/12345">AB12</a>' }]).length, 0);
});
test('counts only successful sale/capture, separates refunds and ignores failed refund', () => {
  const parsed = extractGiftUses([transaction(), transaction({ id: 'refund', kind: 'REFUND' }), transaction({ id: 'failed', kind: 'REFUND', status: 'ERROR' }), transaction({ id: 'auth', kind: 'AUTHORIZATION' })], 'fallback');
  assert.equal(parsed.uses.length, 2);
  assert.equal(parsed.uses.filter((entry) => entry.kind !== 'REFUND').reduce((sum, entry) => sum + entry.amount, 0), 100.25);
});
test('transaction ID is the dedupe key, not order and amount', () => {
  const parsed = extractGiftUses([transaction(), transaction(), transaction({ id: 'tx2' })], 'fallback');
  assert.equal(parsed.uses.length, 2);
});
test('unidentified successful gift payment remains visibly unresolved', () => {
  const parsed = extractGiftUses([transaction({ receiptJson: { gift_card_last_characters: 'AB12' } })], 'fallback');
  assert.equal(parsed.uses.length, 0); assert.equal(parsed.unidentifiedTransactions, 1);
});
test('links redemption received before issuance; does not claim balance', () => {
  const source = order({ issued: extractIssuances([event()]) });
  const destination = order({ orderId: 'o2', email: 'recipient@example.com', giftCardUnits: 0, uses: extractGiftUses([transaction()], '').uses });
  const result = buildGiftLedger([destination, source]);
  assert.equal(result.cards.length, 1); assert.equal(result.cards[0].purchase.orderId, 'o1');
  assert.equal(result.cards[0].uses[0].order.orderId, 'o2'); assert.equal(result.cards[0].balance, undefined);
  assert.equal(result.cards[0].fraud, undefined);
});
test('same suffix is never evidence; tenant and store boundaries are respected', () => {
  const source = order({ issued: extractIssuances([event()]) });
  const otherStore = order({ storeId: 'other', orderId: 'o2', uses: extractGiftUses([transaction()], '').uses });
  const otherTenant = order({ tenantId: 'other', orderId: 'o3', uses: extractGiftUses([transaction()], '').uses });
  const sameSuffix = order({ orderId: 'o4', issued: extractIssuances([event('99999')]) });
  const result = buildGiftLedger([source, otherStore, otherTenant, sameSuffix]);
  assert.equal(result.cards.length, 4); assert.equal(result.cards.filter((card) => card.purchase && card.uses.length).length, 0);
});
test('conflicting purchase claims are explicitly flagged', () => {
  const issued = extractIssuances([event()]);
  const result = buildGiftLedger([order({ issued }), order({ orderId: 'o2', issued })]);
  assert.equal(result.cards[0].purchaseConflict, true);
});
test('different recipient triggers the existing risk signal only with a flagged source order', () => {
  const ledger = buildGiftLedger([order({ issued: extractIssuances([event()]) }), order({ orderId: 'o2', email: 'recipient@example.com', uses: extractGiftUses([transaction()], '').uses })]);
  assert.equal(hasFlaggedGiftSource(ledger.cards, 'test-store', 'o2', []), false);
  for (const status of ['resolved', 'false-positive']) assert.equal(hasFlaggedGiftSource(ledger.cards, 'test-store', 'o2', [{ storeId: 'test-store', orderId: 'o1', status }]), false);
  assert.equal(hasFlaggedGiftSource(ledger.cards, 'test-store', 'o2', [{ storeId: 'test-store', orderId: 'o1', status: 'new' }]), true);
  assert.equal(hasFlaggedGiftSource(ledger.cards, 'other-store', 'o2', [{ storeId: 'test-store', orderId: 'o1', status: 'new' }]), false);
});
