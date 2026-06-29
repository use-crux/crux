# Cookieless PostHog With Vercel Analytics For Geo

Status: Accepted
Date: 2026-06-29

The docs/marketing site (`apps/docs`) runs PostHog for funnel and named-event analytics. The
initial setup used PostHog's default cookie persistence, which requires a consent banner for EU
visitors. The site also runs Vercel Web Analytics (`<Analytics />` in the root layout), which is
cookieless and already provides pageviews and country breakdown without a banner.

**Decision**

- Set PostHog `cookieless_mode: 'always'` in `instrumentation-client.ts`. PostHog never writes
  cookies or local/session storage; visitors are counted via a daily server-side hash.
- **Do not add a cookie consent banner.** This matches common practice for open-source developer-tool
  docs/marketing sites.
- **Keep Vercel Web Analytics** as the geo and aggregate-pageview layer. Vercel resolves country from
  IP server-side then discards it — PostHog cookieless mode does not enrich GeoIP (IP is stripped
  before the transformation runs).
- Accept the PostHog trade-offs: no cross-session retention, no session replay, no `identify()`, no
  PostHog GeoIP. Within-session page paths, Named Events, autocapture, and funnels still work.
- Enable **Cookieless server hash mode** in the PostHog project settings (Project Settings → Web
  analytics) before relying on visitor counts in production.

**Considered Options**

- _Cookieless `on_reject` + consent banner_ — rejected for now: adds friction on a dev-tool site;
  revisit if session replay or retention becomes a growth requirement.
- _Cookies + banner for full PostHog GeoIP_ — rejected: Vercel already covers regions without a
  banner; duplicating geo in PostHog does not justify consent UX cost.

**Consequences**

- Server-side `docs_searched` events no longer correlate with client visitors (no `ph_*` cookie). They
  use a synthetic distinct id with `$process_person_profile: false`.
- Analytics responsibility is split: **Vercel** for regions and top pages; **PostHog** for funnels,
  Named Events, within-session paths, and search volume. Document this split in `CONTEXT.md`.
- Supersedes the open consent item in ADR 0001.
