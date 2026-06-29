# PostHog Analytics Instrumentation For The Docs Site

Status: Accepted
Date: 2026-06-29

The Crux docs/marketing site (`apps/docs`) was instrumented with PostHog (initially via the PostHog
setup wizard, then corrected and extended). We want product analytics for the marketing funnel and
documentation usage without coupling the analytics surface to autocapture noise, and without leaking
analytics latency into the fumadocs search experience.

**Decision**

- Initialize PostHog client-side in `instrumentation-client.ts` (the Next.js 15.3+ convention) against
  the **EU** PostHog host, routed through a same-origin **Ingest Proxy** at `/ingest` configured with
  Next.js `rewrites` (covering `/ingest`, `/ingest/static/*`, and `/ingest/array/*`).
- Keep PostHog **autocapture**, automatic `$pageview` on App Router history changes, `$pageleave`, and
  `capture_exceptions` enabled — these cover doc-page views and generic clicks for free.
- Author **Named Events** only through a single `TrackedLink` client component, reserved for the
  marketing funnel CTAs and outbound **GitHub/npm** links. Outbound links open in a new tab so the
  capture fires before navigation (autocapture of outbound clicks is unreliable).
- Capture the server-side `docs_searched` event inside the fumadocs `app/api/search/route.ts`. Return
  search results first and flush PostHog in `after()` so search-as-you-type latency is not tied to a
  round-trip to PostHog. Read the visitor's Distinct ID from the `ph_<token>_posthog` cookie to
  correlate with client events, and set `$process_person_profile: false` when no cookie is present.
- Keep secrets out of source: the `NEXT_PUBLIC_POSTHOG_*` values live in `.env.local` (gitignored) and
  must be set in the hosting provider for production.

**Considered Options**

- _Built-in fumadocs GitHub link / popover source link_ — rejected for outbound tracking because they
  expose no click hook; replaced/supplemented with `TrackedLink` icon links we control.
- _Awaiting `posthog.flush()` before returning search results_ — rejected: it added EU round-trip
  latency to every keystroke and attributed all searches to one synthetic id.

**Consequences**

- `apps/docs` is a private, unpublished app, so these changes affect no `@use-crux/*` npm package and
  require **no changeset**.
- The per-doc-page GitHub "view source" link moved out of the fumadocs view-options popover into a
  visible header icon button, a deliberate UX change made to enable reliable tracking.
- **Consent resolved in ADR 0002.** PostHog runs in `cookieless_mode: 'always'` (no banner). Vercel
  Web Analytics covers geo and aggregate pageviews.
