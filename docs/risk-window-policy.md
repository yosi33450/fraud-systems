# Purchase velocity policy (v3)

The general email and IP policies trigger on **more than 3 purchases in rolling
60 minutes**, or **more than 5 in rolling 24 hours**. Order amount triggers
strictly above **ILS 1,500 for one order**, never on a grouped customer total.
Special gift-card, identity, employee and network rules remain separate.

Windows are anchored to each order's `createdAt`, not to the time it was imported.
The interval is `(orderTime - window, orderTime]`: include the current purchase
once, exclude future orders and the exact lower boundary. Only the same tenant
and store are considered. Missing identities, shared payment-provider emails,
and orders without positive purchase/gift-card value cannot trigger velocity.
Each configured condition uses its own window; the old fixed-window fields are
retained only for compatibility and the investigation detail display.

Rule edits and historical-sync completion recount existing active and
automatically closed alerts from stored orders. Scores and evidence are replaced,
not accumulated. Cases that no longer qualify receive an explicit automatic
closure, not a merchant-treated decision. Merchant-resolved, legitimate and fraud
decisions are preserved. Orders and gift-card evidence are never deleted.

The authenticated owner-only `POST /api/tenants/:tenantId/rules/reconcile` accepts
`{"policy":"velocity-windows-v3"}`. The policy update is recorded once per tenant,
so retries do not overwrite subsequent merchant customizations. Recounting is
retryable. Newly qualifying historical purchases are hydrated from Shopify before
opening a case; no customer data is invented and no historical emails are sent.
The response reports any failed/pending replays (at most ten attempted per call).

Tests (isolated synthetic fixtures, never written to the application data):

    node --experimental-strip-types --test tests/*.test.mjs
