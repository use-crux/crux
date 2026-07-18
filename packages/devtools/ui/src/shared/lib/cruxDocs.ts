/**
 * Crux docs URL resolution.
 *
 * Index lint findings (and any other rule-style surface that ships a
 * `docsUrl` field) keep their docs slugs short — e.g. `lints/no-eval-coverage`
 * — and the UI joins them onto a configurable base domain. The default
 * points at the local docs dev server (`http://localhost:3001`); for
 * packaged builds you set `CRUX_DOCS_URL` at build time (see
 * `vite.config.ts` `envPrefix`) and the helper picks it up.
 *
 * Absolute URLs (anything starting with `http://` / `https://`) pass
 * through untouched so a backend that already ships a full URL still
 * works, and a `null`/`undefined` slug returns `null` so call sites can
 * gate render with a simple boolean.
 */

const FALLBACK_BASE = "http://localhost:3001";

function baseUrl(): string {
  // `import.meta.env` is replaced at build time by Vite. The
  // `CRUX_DOCS_URL` key is exposed via `envPrefix` in vite.config.ts.
  const fromEnv = (import.meta.env as Record<string, string | undefined>)
    .CRUX_DOCS_URL;
  return (fromEnv && fromEnv.trim()) || FALLBACK_BASE;
}

/** Resolve a docs slug or path to an absolute URL, or `null` if the
 *  input is missing. Handles three shapes:
 *
 *  - `null` / `undefined` / `""` → `null`
 *  - absolute URL (http/https)   → returned as-is
 *  - relative (with or without a leading slash) → joined onto the base
 */
export function cruxDocsUrl(docsUrl: string | null | undefined): string | null {
  if (!docsUrl) return null;
  const trimmed = docsUrl.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = baseUrl().replace(/\/+$/, "");
  const path = trimmed.replace(/^\/+/, "");
  return `${base}/${path}`;
}
