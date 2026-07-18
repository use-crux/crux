import {
  getEvalTaskDescriptorForInternalUse,
  isManagedEvalTaskForInternalUse,
} from "./task";

/** Fail before inference when an untyped Variant task rejects a selected Case. */
export async function assertTaskAcceptsCase(
  task: unknown,
  variant: string,
  caseId: string,
  value: unknown,
  call: Readonly<Record<string, unknown>> | undefined,
  overrides: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (!isManagedEvalTaskForInternalUse(task)) return;
  const descriptor = getEvalTaskDescriptorForInternalUse(task);
  const schema = descriptor.inputSchema;
  if (schema !== undefined) {
    let result;
    try {
      result = await schema["~standard"].validate(value);
    } catch (error) {
      throw new TypeError(
        `planEval(): Variant '${variant}' task could not validate Case '${caseId}' input: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (result.issues !== undefined) {
      throw new TypeError(
        `planEval(): Variant '${variant}' task does not accept Case '${caseId}' input: ${result.issues.map(formatSchemaIssue).join("; ")}`,
      );
    }
  }
  try {
    descriptor.validateVariantCall?.(call, overrides);
    await descriptor.validateVariantInput?.(value, overrides);
  } catch (error) {
    throw new TypeError(
      `planEval(): Variant '${variant}' task does not accept Case '${caseId}' input: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function formatSchemaIssue(issue: {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}): string {
  const path = issue.path
    ?.map((segment) =>
      typeof segment === "object" && segment !== null
        ? String(segment.key)
        : String(segment),
    )
    .join(".");
  return path === undefined || path.length === 0
    ? issue.message
    : `${path}: ${issue.message}`;
}
