/** Completed operations with Core-owned canonical Safety projections. */
export type SafetyCompletedOperation =
  | "generateImage"
  | "generateSpeech"
  | "transcribe";

/** Narrow a public operation name to the closed Safety projection table. */
export function isSafetyCompletedOperation(
  operation: string,
): operation is SafetyCompletedOperation {
  return (
    operation === "generateImage" ||
    operation === "generateSpeech" ||
    operation === "transcribe"
  );
}
