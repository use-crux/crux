/** Runtime validation helpers for persisted statistics state. @internal */

export type UnknownObject = Record<string, unknown>;

export function readObject(value: unknown, label: string): UnknownObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(label);
  }
  return value as UnknownObject;
}

export function exactKeys(
  value: UnknownObject,
  required: readonly string[],
  optional: readonly string[] = [],
  label = "value",
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    invalid(label);
  }
}

export function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(label);
  return value;
}

export function readLiteral<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    invalid(label);
  }
  return value as T;
}

export function readInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(label);
  return value as number;
}

export function readFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    invalid(label);
  }
  return value;
}

export function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(label);
  return value;
}

export function readDate(value: unknown, label: string): Date {
  const text = readString(value, label);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) {
    invalid(label);
  }
  return date;
}

export function optional<T>(
  value: UnknownObject,
  key: string,
  read: (candidate: unknown, label: string) => T,
  label: string,
): T | undefined {
  return Object.hasOwn(value, key)
    ? read(value[key], `${label}.${key}`)
    : undefined;
}

export function sameRecord(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

export function invalid(label: string): never {
  throw new TypeError(`Invalid statistics ledger ${label}.`);
}
