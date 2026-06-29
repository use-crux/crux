# Crux Docs Context

The Crux marketing + documentation site (`apps/docs`), a fumadocs/Next.js App Router app. This
glossary currently covers the analytics instrumentation vocabulary; extend it as other domains of the
site are resolved.

## Language

### Analytics

**Named Event**:
A deliberately authored PostHog event with a stable name and curated properties (e.g.
`get_started_clicked`), fired from application code.
_Avoid_: custom event, manual event, tracked event

**Autocapture Event**:
A generic interaction event PostHog records automatically (`$autocapture`, `$pageview`,
`$pageleave`, `$exception`) without per-call authoring.
_Avoid_: auto event, implicit event

**TrackedLink**:
The client component (`components/tracked-link.tsx`) that wraps `next/link` to fire a Named Event on
click. The single sanctioned way to attach a Named Event to a link.
_Avoid_: analytics link, event link, posthog link

**Ingest Proxy**:
The same-origin `/ingest` path that reverse-proxies PostHog ingestion and asset requests to the EU
PostHog host via Next.js rewrites, so requests are less likely to be blocked.
_Avoid_: posthog proxy, reverse proxy, /ingest endpoint

**Cookieless Mode**:
PostHog configuration (`cookieless_mode: 'always'`) that never writes cookies or browser storage.
Visitors are counted via a daily server-side hash. No consent banner is required for PostHog.
_Avoid_: opt-out mode, no-cookie setting

**Distinct ID**:
The visitor identifier PostHog uses to stitch events. In cookieless mode it is a server-side hash,
not a browser cookie. Server-side events do not share this id with the client.
_Avoid_: user id, session id, visitor id

**Person Profile**:
A PostHog person record. Server-side search events suppress profile creation
(`$process_person_profile: false`) because cookieless mode provides no client id to correlate with.
_Avoid_: user record, identity

**Vercel Web Analytics**:
The cookieless `@vercel/analytics` integration in the root layout. Owns aggregate pageviews and
**region/country** breakdown. Complements PostHog; does not fire Named Events.
_Avoid_: Vercel tracking, secondary analytics

## Relationships

- A **TrackedLink** fires exactly one **Named Event**; ordinary `next/link` usage relies only on
  **Autocapture Events**.
- All client and server PostHog events flow through the **Ingest Proxy** to the EU PostHog host.
- PostHog runs in **Cookieless Mode**; **Vercel Web Analytics** covers geo and top-level pageviews.
- Server-side **Named Events** (e.g. `docs_searched`) are anonymous and do not share a **Distinct ID**
  with client events.
- **Autocapture Events** cover doc-page navigation (`$pageview`) and generic clicks within a session;
  **Named Events** cover the marketing funnel and outbound GitHub/npm links.

## Named event taxonomy

- `get_started_clicked`, `docs_cta_clicked`, `comparison_cta_clicked`,
  `observability_demo_clicked` — marketing-page CTAs.
- `github_link_clicked` — navbar, footer, and per-doc-page source links (carries `location`, plus
  `slug` on doc pages).
- `npm_link_clicked` — navbar and footer npm-package links.
- `docs_searched` — server-side, fired from the fumadocs search route with the query string.

## Example dialogue

> **Dev:** "If I add a new CTA, do I get an event for free?"
> **Maintainer:** "You get an **Autocapture Event** for free. If you want a **Named Event** like
> `get_started_clicked`, wrap it in a **TrackedLink** — that's the only sanctioned path."
> **Dev:** "Where do I see which countries visitors come from?"
> **Maintainer:** "**Vercel Web Analytics** — PostHog is in **Cookieless Mode** and doesn't enrich
> GeoIP. PostHog owns funnels and Named Events; Vercel owns regions and aggregate pageviews."

## Flagged ambiguities

- "tracking" was used to mean both **Named Events** and **Autocapture Events** — resolved: these are
  distinct. Outbound links (GitHub/npm) use **Named Events**; most in-app clicks are **Autocapture**.
- "analytics" was used to mean both PostHog and Vercel — resolved: **Vercel Web Analytics** for geo
  and pageviews; PostHog for funnels, Named Events, and within-session paths.
