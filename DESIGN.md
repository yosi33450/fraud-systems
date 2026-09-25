# Shield Ledger — merchant operations UI

## Scope and audit (2026-09-25)

Presentation only. Preserve handlers, queries, permissions, rules, currency calculations,
case grouping, statuses, Shopify connections and stored records. No sample data.

Screens: overview; investigation queue; linked-group and individual-order dialogs;
gift-card ledger, routes and proof dialogs; stores and connection form; employees and
add form; risk rules and condition editor; email settings and delivery history;
shared fraud matches; team; platform administration; login; loading and error boundaries.
Navigation remains RTL, with a persistent desktop sidebar and compact-screen menu.

Audit findings:
- globals.css contains several historical design passes; tiny 9–12px metadata, mixed
  numerical fonts and conflicting responsive styles undermine readability.
- The dark sidebar competes with risk information. Repeated floating cards, gradients,
  colored edge strips and pill collections give unrelated areas equal emphasis.
- Some narrow layouts hide amounts; forms and identifiers need room to wrap without
  losing evidence. Dense modal content needs consistent section and row rhythms.
- Existing inert placeholder actions (team invitation/platform creation/history) are
  outside this visual task; do not invent functionality or silently remove features.

## Directions considered

1. Merchant operations — Heebo throughout; light neutral canvas, forest-green actions;
   medium-high density; continuous ledgers, quiet navigation, flat controls and short
   state transitions. Familiar operational principles from Shopify admin and Stripe.
2. Security console — dark graphite, compact technical typography, alert-led layout;
   sharp controls and little motion. Appropriate for SOC analysts, less approachable
   for shop owners and Hebrew-heavy customer investigation.
3. Editorial finance — warmer paper, large typographic totals, spacious asymmetric
   sections and soft transitions. Attractive but wastes space during repetitive review.

Choose **merchant operations**, not a combination of all three. UI/UX Pro Max's
data-dense/drill-down principle fits; its suggested monospace/dark palette does not
fit Hebrew or the user's explicit preference for normal-looking numbers.

## System specification

- Font: locally bundled Heebo Variable for Hebrew, Latin, identifiers and numbers.
  Same-family pairing: 400/500 for reading, 650/700 for hierarchy; tabular figures
  for comparison, never a coding font. Body 16px, secondary 14px, metadata 13px,
  section headings 20px, page headings 30px, prominent totals 32px. Unit scale in rem.
- Spacing: 4, 8, 12, 16, 24, 32, 48px. Desktop page inset 32px, mobile 16px.
- Surfaces: canvas #f5f6f8, content #ffffff, quiet grouping #eff3f0.
- Ink #18271f; secondary #526259; action #166848; action hover #105336.
- Semantic text: critical #a32828, high #9b3e12, medium #795000,
  success #166848; pale matching backgrounds, always accompanied by text/icon.
- Borders: 1px #dce2de for grouping, #9daaA2 for input affordance.
- Radius: 6px small marks, 8px controls, 12px major surfaces/dialogs; no pill default.
- Elevation: only dialogs and mobile navigation. No ordinary card hover shadows.
- Icons: existing Lucide outlines, 18–20px, consistent stroke; decorative icons hidden
  from assistive tech. No new illustration, stock imagery or decorative animation.
- Buttons: solid green primary; white outlined secondary; quiet text tertiary;
  red only for consequential fraud decisions. Target size at least 44px.
- Forms: visible labels, 16px inputs, explicit focus outlines, full-width domain field;
  maintain existing validation and submissions. Switches expose checked state.
- Tables/lists: one shared surface, subtle row separators, readable secondary text,
  aligned tabular numbers, row hover plus keyboard focus. On mobile rearrange fields
  into a compact ledger entry rather than suppressing amounts.
- States: meaningful empty copy and existing action; subdued loading skeleton;
  visible inline error; 2px solid focus ring with offset; disabled controls identifiable.
- Motion: color/background/opacity only, 120–160ms. Respect reduced motion.
- Dialogs: centered investigation workflow retained; clear header, independently
  scrollable evidence, persistent decision actions, natural wrapping of identifiers.

## Implementation and verification

Legacy structure is isolated in a CSS cascade layer. product-ui.css is the authoritative
visual system; this avoids fragile specificity escalation and preserves layout fallbacks.
Validate the investigation queue first, then propagate the same tokens to every screen.
Check desktop, tablet and 375px mobile, keyboard focus, open/close dialogs and forms
without submitting live actions. Run typecheck, build and existing financial-link tests.
