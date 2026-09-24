# Shield Ledger — Design System

## Product context

Shield Ledger is a Hebrew-first, RTL fraud-operations platform for Shopify merchants in Israel. The platform owner provisions tenants and connects their Shopify stores. Every merchant sees only their own stores, orders, employees, alerts, and reports. The shared blacklist is invisible and only appears as a risk signal on a merchant's own order.

The primary user is an operations or finance analyst who must understand why an order is suspicious and decide what to do quickly. The interface should feel like an evidence ledger: calm, precise, auditable, and trustworthy rather than dramatic or cyberpunk.

## Product architecture

- Platform Control Center: tenants, store connections, sync health, global rules, blacklist reports, audit, and break-glass support.
- Merchant Command Center: live case queue, multi-store summary, severity distribution, gift-card anomalies, employee risk, and integration health.
- Investigation case: score, status, order facts, vertical evidence chain, identity links, Shopify timeline, notes, assignment, and decision controls.
- Rules: global rule catalog with tenant-specific enabled state, thresholds, and bounded weights.
- Employees: manually managed or CSV-imported employee identities and related purchases/refunds.
- Team and access: tenant owner, admin, analyst, viewer.

## Visual thesis

Use a light Evidence Ledger direction. The memorable signature is a vertical evidence spine running down the right side of an investigation, connecting time-stamped evidence nodes. It should resemble an accountable case file, not a generic grid of SaaS cards.

Avoid glassmorphism, neon cyber-security colors, excessive gradients, giant KPI cards, rounded-everything interfaces, and decorative illustrations. Use color only when it encodes severity, state, or action.

## Color tokens

- Canvas / Paper: `#F6F8F7`
- Surface: `#FFFFFF`
- Surface muted: `#EDF1EF`
- Ink: `#111827`
- Slate: `#475569`
- Hairline: `#DCE3E0`
- Trust blue: `#274690`
- Low: `#64748B`
- Medium / warning: `#D97706`
- High: `#C2410C`
- Critical: `#B42318`
- Success: `#207A53`

All normal text must meet WCAG AA. Severity must always include a text label and icon in addition to color.

## Typography

- Interface and Hebrew copy: `Noto Sans Hebrew`, system fallback.
- Technical data, order IDs, timestamps, scores, and identifiers: `IBM Plex Mono`.
- Page title: 28px / 700.
- Section title: 18px / 700.
- Body: 14px / 400 with 1.55 line height.
- Metadata: 12px / 500.
- Large score: 40px / 700, tabular numerals.

## Geometry and spacing

- 8px spacing grid.
- Main shell: 16px outer gap, 240px right-side navigation in RTL.
- Surface radius: 14px; controls: 10px; chips: 999px.
- Borders are 1px hairlines; shadows are rare and subtle.
- Dense tables use 48px rows and sticky headers.
- Interactive targets are at least 44x44px.

## Components

- Sidebar: paper-white, hairline separator, icon + Hebrew label, tenant/store switcher at top.
- Case queue rows: order, customer, amount, score, top reason, store, age, assignee, and state.
- Severity badge: icon + Hebrew label + score range.
- Evidence node: timestamp, rule name, concise explanation, source, score delta, and supporting facts.
- Score panel: numerical score, severity, top three contributors, and Shopify-native risk.
- Filters: compact segmented controls and searchable comboboxes.
- Actions: primary trust-blue; destructive critical-red only for destructive actions.
- Empty states explain the next action and never use decorative filler.

## Layout behavior

- Desktop 1440px: fixed RTL sidebar, fluid main area, investigation uses a 7/5 split between evidence and order context.
- Tablet 768–1024px: collapsible sidebar and single-column investigation sections.
- Mobile 375px: case review only; score and decision bar remain sticky, complex rule configuration is unavailable.
- No horizontal scrolling except intentional data tables with a visible affordance.

## Motion

- 150–220ms opacity and translate transitions for drawers, filters, and row expansion.
- New live cases may receive one restrained background pulse, then settle.
- Respect `prefers-reduced-motion`; never flash severity states.

## Content and interaction rules

- Hebrew labels use direct verbs: “קבל החלטה”, “סמן כהונאה”, “סגור תיק”.
- Never claim certainty: use “אות סיכון”, “התאמה”, and “דורש בדיקה”.
- Every rule result must explain what happened and show the supporting measurement.
- Async actions disable their trigger and show a deterministic success/error result.
- Keyboard order follows RTL visual order; icon-only actions include accessible labels.

## Initial dashboard content

Use realistic Hebrew content: three connected Shopify stores, eight open cases, two critical cases, a gift-card velocity anomaly, one employee-linked refund, and a shared-blacklist match. The main job of the screen is triage: help the analyst decide which case to open next.

