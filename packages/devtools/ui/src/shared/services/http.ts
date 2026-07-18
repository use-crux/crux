export function apiUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

export async function fetchJson<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(apiUrl(path), { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export async function fetchJsonOr404<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T | null> {
  const res = await fetch(apiUrl(path), { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export async function postJson<TBody>(
  path: string,
  body: TBody,
): Promise<Response> {
  return fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteJson<TBody>(
  path: string,
  body?: TBody,
): Promise<Response> {
  return fetch(apiUrl(path), {
    method: "DELETE",
    headers: body != null ? { "Content-Type": "application/json" } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

export async function expectOk(
  response: Response,
  label: string,
): Promise<void> {
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new Error(
      `HTTP ${response.status} · ${label}${detail ? ` · ${detail}` : ""}`,
    );
  }
}
