# Shield Ledger — soft-focus merchant workspace

## Merchant refinement — explicit navigation, less copy

This revision supersedes the quick-navigation and overview details below.
The previous collapse action worked at 1280px and 1920px, but lived outside the
sidebar and was difficult to discover. Move it into the persistent sidebar footer,
with a visible Hebrew label in expanded mode and an accessible expand icon in rail
mode. Define sidebar width and matching content margin in the authoritative CSS,
not only through the historical layout layer. Preserve mobile overlay behavior.

- Remove the quick-navigation control, dialog, keyboard listener and unused styles.
- Replace the inert organization control with real navigation to the existing stores
  screen. Remove the inert store dropdown, unused extra-filter control and decorative
  account chevron; the working store/severity filters and all destinations remain.
- Follow Mosaic's compact summary, persistent sidebar expansion control, and continuous
  table pattern, with the existing Hebrew type, restrained green, rounded surfaces
  and real data. No reference assets, template code or fabricated charts are imported.
- Shorten the overview heading and connection copy. Keep financial and automatic-
  closure qualifications visible. Secondary shortcuts become quiet inline actions.
- Reduce summary height, align supporting activity figures side by side, keep table
  title and counts together, and give the queue more of the first viewport.
- Backend, rule evaluation, order linking, calculations and stored data are unchanged.

QA: verified the footer toggle at 1280px and 1920px (252px expanded / 80px rail,
with equal content offsets), persistence after reload, working search and severity
filters, real store navigation, all desktop destinations, and stacked group/order
dialogs. At 375px, verified no page overflow, full mobile navigation, focus transfer,
background inertness and dismissal after choosing a destination. Build/typecheck and
all 16 existing evidence/money-summary tests passed. No live decisions or forms submitted.

## Mosaic-inspired workspace revision

Reference requested by the merchant: https://github.com/cruip/tailwind-dashboard-template
Reviewed its Sidebar.jsx, Header.jsx, Dashboard.jsx and DashboardCard01.jsx. Adopt
interaction principles, not copied components/assets, sample data, branding, or charts.
Keep Next.js, Hebrew RTL, Heebo, the green identity and all existing business logic.

- A full 252px sidebar collapses into an 80px icon rail. Sidebar width and main-content
  offset use the same 240ms ease-out transition; this layout animation is necessary
  for the explicitly requested resizing behavior. Reduced motion disables it.
- Save the preference locally, guarded against unavailable storage; never write tenant
  settings. Mobile navigation stays independent and always opens with full labels.
- Group destinations into monitoring/investigations and store management. Preserve all
  destinations. Provide names, active state and counts to assistive tech in either mode;
  collapsed buttons show tooltips on pointer hover or keyboard focus.
- Compact sticky header with a current-workspace label and a quick-navigation dialog.
  Ctrl/Cmd+K, search, arrow-key selection, Enter and Escape work without fetching data.
- Mobile menu traps focus, dismisses with Escape/backdrop, restores trigger focus,
  makes background content inert and unlocks cleanly on a desktop breakpoint.
- Smaller summary padding and figures (44px open cases, 30px money); preserve the
  exact figures and their meaning. Supporting numbers stay visually secondary.
- Use 20px main surfaces, compact 68px section headers, 100px investigation rows,
  64px contextual navigation rows, and consistent page action alignment.
- Do not import demo financial trends, fake charts, promotional banners, or inert
  template controls. Existing investigations, rules, scanning and data are untouched.

Typecheck, production build and all 16 existing gift-evidence/summary tests pass.

## Revision after merchant feedback (2026-09-25)

The previous flat-ledger direction was rejected: excessive lines, square controls,
and equal-weight headings/numbers made the overview difficult to parse. This revision
supersedes its radius, elevation and overview layout rules below.

Direction: **soft focus**. Apply Apple's clarity, hierarchy and generous target-size
principles to a Hebrew merchant tool, not an imitation of a native Apple application.
Impeccable's product guidance keeps real evidence, actions and predictable behavior
central. Keep locally bundled Heebo: its Hebrew and numerals share a consistent voice,
without depending on proprietary system fonts or loading a second decorative family.

- Open work is the visual anchor: a soft sage surface, 52px count, explicitly labeled
  critical count, and a single action into the existing investigation queue.
- Money has its own white surface, 34px tabular figure, and a clear distinction between
  order totals and confirmed loss. Calculations are unchanged.
- Automatic rule closures and email delivery are secondary, grouped in one surface.
  Never describe automatic closures as merchant decisions.
- Replace the unused chart placeholder and repeated count with two compact navigation
  rows for email configuration and employee-linked cases. No functional chart existed.
- Radius: 24px primary surfaces/dialogs, 18px supporting groups, 12px inputs, capsule
  action buttons, circular icon targets. Keep internal table rows continuous.
- Surfaces: #f3f5f6 canvas, white content/navigation, #e3efe8 open-work emphasis.
  Primary green and semantic risk colors remain unchanged. Solid surfaces, no glass.
- Modest surface elevation (3px / 16px at 3.5% opacity); no border + heavy shadow stack.
- Keep a light-only theme in this revision to preserve the existing product's scope.
- Desktop uses a three-part brief; tablet groups supporting activity below; mobile
  places the primary action beside the count and retains all supporting figures.
- The same round controls, grouped summaries and surface tokens propagate to the
  ledger, rules, stores, settings, forms and centered investigation windows.
- Motion is limited to 160ms state transitions and subtle button press feedback.
  Existing keyboard focus, reduced-motion handling and native dialog behavior remain.

Verification for this revision is separate from the prior QA record below. No API,
data, risk, matching, case grouping, authentication or persistence code is changed.

Revision checks: production build and typecheck pass; 16 existing gift-evidence and
financial-summary tests pass. All ten workspaces checked at desktop and 375px for
page overflow. Group and order dialogs retain separate purchase/use figures, open
centrally and dismiss back to the group. No forms, scans or case decisions submitted.
Visual review found a cramped desktop sidebar; keep it 252px until the mobile menu
breakpoint. Closed mobile navigation remains hidden from keyboard focus. Remove the
decorative API tagline from the top bar so real connection status has room on mobile.
Rename the closed-case filter to "closed", not "treated": a wording correction only.

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

## QA record

- Reviewed all ten workspaces on desktop and checked each at 375px: no page-level
  horizontal overflow. Investigations also reviewed at 768px and 1440px.
- Group dialog preserves the separate purchase/redemption totals; the large purchase
  list remains independently scrollable. Escape returns focus to the originating row.
- Store connection and rule editing now reuse the existing native centered dialog:
  focus trapping, Escape dismissal and focus restoration without changing submissions.
- Switch checked state, current navigation, condition-select labels and login error
  associations are exposed to assistive technology. Closed mobile navigation is hidden
  from focus. Changing workspaces returns the viewport to the heading.
- Core text/action colors have contrast ratios of 5.98:1 or higher on the canvas;
  semantic badge pairings are 5.90:1 or higher. This is not a full WCAG certification.
- Build/type checks pass; all 16 existing gift evidence and monetary-summary tests pass.
- No data, API, authentication, risk-engine or persistence modules changed. No forms
  were submitted, scans triggered, or case decisions changed during visual QA.
- Loading/error screens were reviewed in source; loading and login also observed in
  the browser. No deliberate production errors were induced to exercise the boundary.
