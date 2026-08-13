export interface NativeProducer {
  readonly kind: string
  readonly name: string
  readonly version: string
  readonly adapterVersion: string
}

export type NativeCoordinate =
  | { readonly kind: 'document'; readonly documentSha256: string }
  | { readonly kind: 'logical-table'; readonly rowStart: number; readonly rowEnd: number }
  | { readonly kind: 'sheet-range'; readonly sheet: string; readonly range: string }
  | { readonly kind: 'page'; readonly page: number }
  | { readonly kind: 'page-block'; readonly page: number; readonly block: number; readonly start: number; readonly end: number }
  | { readonly kind: 'slide'; readonly slide: number }
  | { readonly kind: 'package-part'; readonly part: string }

export type NativeFact = Readonly<Record<string, unknown>> & {
  readonly kind: string
  readonly factPath: string
}

export function fact(factPath: string, value: Readonly<Record<string, unknown>> & { readonly kind: string }): NativeFact {
  return { ...value, factPath }
}

export function provenance(factPath: string, coordinate: NativeCoordinate, producer: NativeProducer): NativeFact {
  return fact(factPath, { kind: 'provenance', path: factPath, coordinate, producer })
}
