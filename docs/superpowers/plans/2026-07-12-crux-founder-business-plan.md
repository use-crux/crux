# Crux Founder Business Plan — Implementation Plan

**Specification:** `docs/superpowers/specs/2026-07-11-crux-founder-business-plan-design.md`

## 1. Research and claim ledger

- Re-read current Crux vision, roadmap, positioning, README, and package metadata.
- Re-verify time-sensitive competitor capabilities, pricing, acquisitions, funding, and vendor case studies against primary sources.
- Record every external claim on the Sources page with date, source type, and caveat.
- Keep market sizing bottom-up and label every forecast-like number as a scenario or hypothesis.

## 2. Shared static shell

- Create `docs/business-plan/assets/styles.css` with semantic light/dark tokens, responsive sidebar and native mobile navigation, readable editorial typography, tables, cards, diagrams, print rules, focus states, and reduced-motion behavior.
- Create `docs/business-plan/assets/plan.js` for optional theme persistence and current-year metadata only; primary navigation and content must not depend on it.
- Repeat semantic navigation in each HTML page with correct `aria-current` state and relative links.

## 3. Content implementation

- Build the Command Center and Current Position first to establish shared language and honest maturity.
- Build Market, Audience, Product, GTM, and Business Model as the core decision sequence.
- Build Roadmap, Founder Playbook, Metrics/Risks, and Sources as the operating layer.
- Give every substantive page a thesis, evidence/assumption distinction, recommendation, founder action, and decision gate.

## 4. Mechanical validation

- Parse all HTML files and verify local links/assets exist.
- Search for placeholder language, unsupported “shipped” claims, and missing source labels.
- Confirm no remote scripts, fonts, images, analytics, or application runtime dependencies.

## 5. Browser and accessibility validation

- Serve `docs/business-plan/` locally and inspect through the collaborative preview.
- Check desktop, tablet, and approximately 375 px mobile layouts.
- Check dark/light themes, native `<details>` mobile navigation, keyboard focus, skip links, reduced motion, no-JavaScript readability, and print preview styling.
- Fix console errors, horizontal overflow, broken navigation, and contrast or hierarchy problems.

## 6. Final review

- Review the whole plan as a solo-founder operating document: the next action must be obvious and the roadmap must be gated by evidence rather than building volume.
- Ensure specialization remains a validated horizon, not the assumed immediate product.
- Remove visual-brainstorming temporary files and report the exact artifact entry point.

