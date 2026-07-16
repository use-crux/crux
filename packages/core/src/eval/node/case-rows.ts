/** Data-only Case row parsing and Standard Schema validation. */

import { readFile } from "node:fs/promises";
import type { StandardSchemaV1 } from "../../quality/standard-schema";
import type { JsonValue } from "../../storage";
import type { RawEvalCase } from "../internal/definition";
import { fingerprintEvalValueForInternalUse } from "../internal/runner";
import type { LoadedEvalCase } from "./cases";
import { EvalCaseFileError } from "./case-path";

type EvalCaseMetadata = Readonly<Record<string, JsonValue>>;

interface LoadCaseRowsOptions {
  readonly path: string;
  readonly displayPath: string;
  readonly kind: "authored" | "sidecar";
  readonly inputSchema: StandardSchemaV1;
  readonly expectedSchema?: StandardSchemaV1;
}

/** Read and validate one serialized Case source. */
export async function loadCaseRows(
  options: LoadCaseRowsOptions,
): Promise<readonly LoadedEvalCase[]> {
  const text = await readFile(options.path, "utf8").catch((error: unknown) => {
    throw new EvalCaseFileError(
      options.displayPath,
      `cannot read file (${errorMessage(error)})`,
    );
  });
  const loaded: LoadedEvalCase[] = [];
  for (const row of parseRows(text, options.displayPath)) {
    loaded.push(await normalizeRow(row, options));
  }
  assertUniqueCaseIds(loaded);
  return Object.freeze(loaded);
}

interface ParsedRow {
  readonly value: unknown;
  readonly line: number;
}

function parseRows(text: string, path: string): readonly ParsedRow[] {
  try {
    if (path.endsWith(".jsonl")) {
      return text
        .split(/\r?\n/)
        .flatMap((line, index) =>
          line.trim() === ""
            ? []
            : [{ value: JSON.parse(line) as unknown, line: index + 1 }],
        );
    }
    if (path.endsWith(".csv")) return parseCsv(text);
    if (path.endsWith(".json")) {
      const value = JSON.parse(text) as unknown;
      if (!Array.isArray(value)) {
        throw new EvalCaseFileError(
          path,
          "JSON Case files must contain an array of rows",
        );
      }
      return value.map((row, index) => ({ value: row, line: index + 1 }));
    }
    throw new EvalCaseFileError(
      path,
      "supported extensions are .json, .jsonl, and .csv",
    );
  } catch (error) {
    if (error instanceof EvalCaseFileError) throw error;
    throw new EvalCaseFileError(path, `invalid row (${errorMessage(error)})`);
  }
}

function parseCsv(text: string): readonly ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const headers = lines[0]!.split(",").map((header) => header.trim());
  return lines.slice(1).map((line, index) => {
    const cells = line.split(",").map((cell) => cell.trim());
    return {
      line: index + 2,
      value: Object.fromEntries(
        headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]),
      ),
    };
  });
}

async function normalizeRow(
  row: ParsedRow,
  options: LoadCaseRowsOptions,
): Promise<LoadedEvalCase> {
  const origin = `${options.displayPath}:${row.line}`;
  if (!isRecord(row.value)) {
    throw new EvalCaseFileError(origin, "row must be a JSON object");
  }
  const record = row.value;
  if (options.kind === "sidecar") assertReviewCaseRow(record, origin);
  if (record.expect !== undefined || record.afterScores !== undefined) {
    throw new EvalCaseFileError(
      origin,
      "file-backed Cases cannot contain callbacks",
    );
  }
  const input = await validateSchema(
    options.inputSchema,
    record.input !== undefined ? record.input : record,
    origin,
    "input",
  );
  const expected =
    record.expected === undefined
      ? undefined
      : options.expectedSchema === undefined
        ? record.expected
        : await validateSchema(
            options.expectedSchema,
            record.expected,
            origin,
            "expected",
          );
  const authored: RawEvalCase = Object.freeze({
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    ...(typeof record.name === "string" ? { name: record.name } : {}),
    input,
    ...(record.call !== undefined ? { call: record.call } : {}),
    ...(expected !== undefined ? { expected } : {}),
    ...(expected !== undefined && options.expectedSchema === undefined
      ? { unvalidatedExpected: true as const }
      : {}),
    ...(typeof record.trials === "number" ? { trials: record.trials } : {}),
    ...(Array.isArray(record.tags)
      ? { tags: Object.freeze([...record.tags]) as readonly string[] }
      : {}),
    ...(isRecord(record.metadata)
      ? { metadata: Object.freeze({ ...record.metadata }) as EvalCaseMetadata }
      : {}),
    ...(typeof record.skip === "boolean" || typeof record.skip === "string"
      ? { skip: record.skip }
      : {}),
    ...(typeof record.only === "boolean" ? { only: record.only } : {}),
  });
  const id = authored.id ?? fingerprintEvalValueForInternalUse(input);
  if (id.trim() === "")
    throw new EvalCaseFileError(origin, "Case id must be non-empty");
  return Object.freeze({
    id,
    origin,
    authored,
    unvalidatedExpected:
      expected !== undefined && options.expectedSchema === undefined,
  });
}

async function validateSchema(
  schema: StandardSchemaV1,
  value: unknown,
  origin: string,
  field: string,
): Promise<unknown> {
  const result = await schema["~standard"].validate(value);
  if (result.issues !== undefined) {
    throw new EvalCaseFileError(
      origin,
      `${field} failed schema validation: ${result.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return result.value;
}

function assertReviewCaseRow(
  row: Readonly<Record<string, unknown>>,
  origin: string,
): void {
  const metadata = row.metadata;
  if (
    row.schemaVersion !== 1 ||
    typeof row.id !== "string" ||
    row.id.trim() === "" ||
    row.input === undefined ||
    !isRecord(metadata) ||
    metadata.source !== "review" ||
    typeof metadata.reviewId !== "string" ||
    typeof metadata.runId !== "string" ||
    typeof metadata.addedAt !== "string"
  ) {
    throw new EvalCaseFileError(origin, "row does not match ReviewCaseRowV1");
  }
}

function assertUniqueCaseIds(cases: readonly LoadedEvalCase[]): void {
  const seen = new Map<string, string>();
  for (const entry of cases) {
    const previous = seen.get(entry.id);
    if (previous !== undefined) {
      throw new EvalCaseFileError(
        entry.origin,
        `duplicate Case id '${entry.id}' from ${previous} and ${entry.origin}`,
      );
    }
    seen.set(entry.id, entry.origin);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
