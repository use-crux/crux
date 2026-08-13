export type AnydocNativeFact = Readonly<Record<string, unknown>> & {
  readonly kind: string
  readonly factPath: string
}

export declare function extractAnydocNativeFacts(
  document: unknown,
  bytes: Uint8Array,
  producer: Readonly<Record<string, string>>,
): readonly AnydocNativeFact[]
