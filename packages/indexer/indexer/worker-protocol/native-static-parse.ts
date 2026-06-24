import { NativeStaticCompilerRequestSchema, type NativeStaticCompilerRequest } from './native-static'

/** Parsed native static request or a JSON-safe validation error. */
export type ParsedNativeStaticCompilerRequest =
  | { readonly ok: true; readonly request: NativeStaticCompilerRequest }
  | { readonly ok: false; readonly error: string }

/** Parse one JSON-line native static compiler request into a typed command. */
export function parseNativeStaticCompilerRequest(line: string): ParsedNativeStaticCompilerRequest {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return { ok: false, error: 'invalid JSON' }
  }

  const parsed = NativeStaticCompilerRequestSchema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid native static request' }
  }
  return { ok: true, request: parsed.data }
}
