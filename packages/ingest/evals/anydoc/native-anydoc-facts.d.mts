import type { NativeFact, NativeProducer } from './native-fact-schema'

export function extractAnydocNativeFacts(document: unknown, bytes: Uint8Array, producer: NativeProducer): readonly NativeFact[]
