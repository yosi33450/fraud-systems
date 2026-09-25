# Gift-card evidence ledger

The dedicated workspace is available from **מעקב גיפטקארדים** or `/?view=gift-cards`.
It groups successful redemptions by store, destination order and currency. Each group
drills down to card IDs, purchase-order timeline events and transaction IDs.
It does not issue, disable, redeem or expose the full redeemable code of a card.

## Evidence, not identity inference

- Issuance: an explicit `/admin/gift_cards/<id>` link in an order's
  `fulfillment_success` BasicEvent `additionalContent`.
- Redemption/refund: `gift_card_id` in `OrderTransaction.receiptJson`, with
  `SUCCESS` status and SALE/CAPTURE/REFUND kind. Refunds are separate from redemption totals.
- An exact card ID **and the same tenant/store** are required to link the sides.
- Last-four characters, names, amounts, or different emails never prove the link.
- Distinct buyer and recipient is normal gifting, not an automatic fraud verdict.
- The existing linked-gift-card risk condition is evaluated on live ingestion only
  when an exact source purchase has an active or merchant-confirmed fraud case and
  available buyer/recipient identifiers differ. Closed/false-positive sources do
  not trigger it. Historical evidence scans do not change case decisions/statuses.
- Missing source or missing transactions is explicitly unknown. No balance or
  initial face value is inferred from order totals, successful charges or absent data.
- Conflicting issuance claims are flagged and excluded from proven-link counts.

The HTML/JSON contents of events and receipts are not guaranteed contracts. The
parser fails closed when they change. Existing `read_orders`/customer access is
used; this path does not request `read_gift_cards`. That scope remains a separate
capability for the native gift-card registry/balances. Availability on one shop is
not a guarantee of coverage on all shops.

## Collection and retention

Two explicit scans: candidate orders already represented in fraud alerts, or **all
orders created in the preceding 30 days**. The latter uses a fixed start/end time
and Shopify cursor, 25 orders per request. Stopping preserves completed evidence;
restarting safely rescans/deduplicates. Navigation or closing the tab stops the
browser-driven scan after the current request, not a persistent background job.

Live order create/update and transaction-create webhooks enrich gift-card orders.
Scanning refreshes the subscriptions. Events that are not yet present require a
later order update or another scan. Reads are bounded at 500 events, 100 line items
and 250 transactions per order; reaching a limit displays incomplete coverage.
This is best-effort evidence coverage, not an exhaustive native gift-card audit.

Evidence is retained beyond the 30-day import window. Repeated scans merge on order,
card and transaction IDs. The independent AES-256-GCM encrypted private Blob ledger
uses ETag compare-and-swap updates, preserving concurrent scan/webhook evidence and
avoiding overwrites of merchant decisions in the existing operational-state blob.
Snapshot reads hydrate the latest independent ledger, including purchase/redemption
links on existing investigation drawers. Local non-Blob setups use the existing
encrypted state persistence backend instead.

## Verification

`node --experimental-strip-types --test tests/gift-card-evidence.test.mjs`

Tests cover nested escaped timeline HTML, invalid input, exact-ID matching,
transaction deduplication, failed/successful refunds, reversed event arrival,
missing identifiers, same-suffix collisions, tenant/store isolation and conflicting
purchase evidence. All fixtures are synthetic and never appear in the product.

`npm run typecheck` and `npm run build` validate integration.

Shopify references: [BasicEvent](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/BasicEvent),
[OrderTransaction](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/OrderTransaction).
# Investigation presentation

Linked alert groups open a centered native dialog; individual investigations open
above it and closing returns focus to the originating order. Escape only closes
the top dialog. Mobile uses the same structure with internal scrolling.

Gift purchases and redemptions must never be added to a combined group total.
Purchase amounts use only `isGiftCard` lines: original total minus allocated
discounts, in shop currency, before refunds/taxes. Legacy evidence without these
amounts is explicitly incomplete until re-scanned; order totals are not a fallback.
Observed usage from those purchases requires an exact, non-conflicting card ID in
the same store, including uses without alerts. Successful refunds remain separate.
Neither the difference nor a missing use is a current gift-card balance.

The scan defaults to **all orders in 30 days**, not only orders already flagged.
Missing sources mean no issuance event was found in collected evidence, not that
the customer did not purchase a card. Older purchases and non-order issuance may
still be unavailable. No match is inferred from suffixes or amounts.
