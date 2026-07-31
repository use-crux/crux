/**
 * Payload-safe detail for `thread.operation` spans.
 *
 * The card reads a closed structural allowlist. Message content and unknown
 * attributes never enter the render tree, even when an older producer emits
 * more data than the current Thread observability contract.
 */

import { Chip, type ChipTone } from "@/devtools/shell/primitives";
import type { ObservabilityRunDetailNode } from "@/types";
import { CardShell, KeyValue } from "./SpanDetailPanelAtoms";

const OPERATIONS = [
  "append",
  "read",
  "edit",
  "select",
  "redact",
  "delete",
  "history.override",
] as const;

type ThreadOperation = (typeof OPERATIONS)[number];

export function ThreadOperationCard({
  node,
}: {
  node: ObservabilityRunDetailNode;
}) {
  const attributes = (node.attributes ?? {}) as Readonly<
    Record<string, unknown>
  >;
  const operation = enumValue(attributes.operation, OPERATIONS);
  const threadId = stringValue(attributes.threadId);
  const decision = stringValue(attributes.decision);
  const state = stringValue(attributes.state);
  const messageCount = numberValue(attributes.messageCount);
  const entryCount = numberValue(attributes.entryCount);
  const roles = stringList(attributes.roles);
  const targetId = stringValue(attributes.targetId);
  const parentId = stringValue(attributes.parentId);
  const selectedHead = stringValue(attributes.selectedHead);
  const head = stringValue(attributes.head);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="plum">{operationLabel(operation)}</Chip>
        {decision && (
          <Chip tone={decisionTone(decision)} dot>
            {decision}
          </Chip>
        )}
        {state && !decision && <Chip tone="muted">{state}</Chip>}
        {attributes.replayed === true && <Chip tone="muted">replayed</Chip>}
      </div>

      <CardShell label="Thread">
        <div className="flex flex-col gap-1.5 px-3.5 py-3">
          {threadId && <KeyValue k="Thread ID" v={threadId} />}
          {messageCount !== undefined && (
            <KeyValue
              k="Messages"
              v={`${messageCount} message${messageCount === 1 ? "" : "s"}`}
            />
          )}
          {entryCount !== undefined && (
            <KeyValue
              k="Entries read"
              v={`${entryCount} entr${entryCount === 1 ? "y" : "ies"}`}
            />
          )}
          {roles.length > 0 && (
            <KeyValue
              k="Roles"
              v={
                <span className="flex flex-wrap gap-1.5">
                  {roles.map((role) => (
                    <Chip key={role} tone="muted" mono>
                      {role}
                    </Chip>
                  ))}
                </span>
              }
            />
          )}
        </div>
      </CardShell>

      {(targetId || parentId || selectedHead || head) && (
        <CardShell label="Thread position">
          <div className="flex flex-col gap-1.5 px-3.5 py-3">
            {targetId && <KeyValue k="Target" v={targetId} />}
            {parentId && <KeyValue k="Parent" v={parentId} />}
            {selectedHead && (
              <KeyValue k="Selected head" v={selectedHead} />
            )}
            {head && <KeyValue k="Head" v={head} />}
          </div>
        </CardShell>
      )}
    </div>
  );
}

function operationLabel(operation: ThreadOperation | undefined): string {
  if (!operation) return "Thread operation";
  if (operation === "history.override") return "History override";
  return operation.charAt(0).toUpperCase() + operation.slice(1);
}

function decisionTone(value: string): ChipTone {
  switch (value) {
    case "selected":
      return "ok";
    case "alternative":
      return "warn";
    default:
      return "muted";
  }
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string"))]
    : [];
}
