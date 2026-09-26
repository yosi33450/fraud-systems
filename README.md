# Shield Ledger

Hebrew-first, RTL fraud-operations dashboard for Shopify merchants. This repository contains a working vertical MVP: tenant-aware operational APIs, an explainable rule engine, a privacy-preserving shared-blacklist model, Shopify Admin GraphQL connectivity, verified webhook ingestion, and an interactive operations dashboard.

## Run locally

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000`.

For normal development use `npm run dev`. In restricted synced workspaces where file watching cannot read the project metadata, use the production commands above.

## Environment

Copy `.env.example` to `.env.local` and set:

- `SHOPIFY_WEBHOOK_SECRET`: HMAC secret used to verify Shopify webhooks. Production must resolve a separate encrypted secret per store.
- `BLACKLIST_HMAC_KEY`: a strong key for deterministic HMAC matching. It must live in KMS in production.
- `SHOPIFY_API_VERSION`: pinned Admin GraphQL version (`2026-07` by default).
- `ALLOW_MANUAL_SHOPIFY_CONNECTIONS`: opt-in guard for the connection-test endpoint. Keep disabled when OAuth is used.
- `RESEND_API_KEY`: enables real owner alert emails. Without it, deliveries are recorded as simulated.
- `EMAIL_FROM`: verified sender address used for risk alerts.
- `APP_URL`: public dashboard URL included in alert emails.
- `STATE_ENCRYPTION_KEY`: at least 32 characters; encrypts the durable operational snapshot, including Shopify access tokens and customer data.
- `BLOB_READ_WRITE_TOKEN`: token for the legacy private Vercel Blob store. Keep it during migration and recovery.
- `PERSISTENCE_BACKEND`: set to `supabase` only after the latest encrypted state has been imported and verified in the new database. Until then, leaving this unset preserves the existing Blob behavior even if Supabase credentials are present.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: preferred production persistence. The service-role key is server-only and must never use a `NEXT_PUBLIC_` prefix.
- `SUPABASE_PUBLISHABLE_KEY` and `PERSISTENCE_API_KEY`: alternative server-only RLS credential used by the pilot deployment when a service-role key isn't provisioned.
- `DASHBOARD_PASSWORD` and `AUTH_SECRET`: protect the owner dashboard when it is publicly deployed.

Local development stores the same encrypted snapshot under `.data/`. The directory is excluded from Git. Production deployments fail closed when neither private Vercel Blob nor Supabase persistence is configured, preventing accidental use of ephemeral serverless memory.

For legacy Shopify organization connections, set server-only `SHOPIFY_CLIENT_ID`. Newly connected stores save their client ID in the encrypted state. Expiring Shopify access tokens are renewed automatically with the existing app credentials; no merchant reconnection is required while those credentials remain valid.

## Database setup

Apply `db/migrations/001_shield_ledger_state.sql` to a Supabase project, then configure the server-side environment variables above. The pilot table has RLS enabled, grants no access to `anon` or `authenticated`, and stores only an AES-256-GCM encrypted payload. Do not enable `PERSISTENCE_BACKEND=supabase` while the table is empty: this would start the app without its store connection, cases, and decisions. Preserve the old Blob and encryption key until the imported snapshot's counts and checksum have been verified. A normalized schema for the production multi-tenant version remains in `db/schema.sql`.

## Implemented

- RTL merchant command center and platform-owner Control Center.
- Live case queue with search, store/severity filters, and investigation drawer.
- Explainable evidence ledger and manual decision workflow.
- Store health, employees, rules, shared-network, team, and tenant screens.
- Typed risk engine with severity bands and initial V1 rules.
- Shopify webhook signature verification endpoint.
- Idempotent webhook processing that converts risky Shopify orders into investigation cases.
- Server-backed case decisions, rule toggles, employee monitoring, and tenant snapshots.
- Editable condition-based rules with `all`/`any` combinations and recommended templates.
- Owner email notification settings, delivery tracking, reminders, and Resend delivery support.
- Platform-owner connection dialog for organization-owned Shopify stores using the client-credentials grant.
- Confirmed-fraud reporting that stores only blind HMAC match keys in the shared network.
- Validated Admin GraphQL operations for shop identity and webhook registration.
- PostgreSQL schema with tenant IDs, RLS policies, encrypted-secret columns, event idempotency, audit, and blind-match keys.

## Production follow-ups

- Replace the encrypted pilot snapshot with the included normalized PostgreSQL schema and authenticated sessions before multi-tenant production rollout.
- Encrypt store credentials through KMS and resolve webhook secrets per connection.
- Add a durable queue for webhook processing, reconciliation jobs, and email delivery.
- Replace the pilot client-credentials connection with merchant OAuth for stores outside the platform owner's Shopify organization.
- Implement password reset, forced temporary-password rotation, and TOTP/WebAuthn 2FA.
- Complete Shopify protected-customer-data review, DPIA, and legal approval before enabling the shared network.
