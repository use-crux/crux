/**
 * Boundary-local, model-safe status context for retained background Work.
 *
 * @internal
 * @module
 */

import type { SystemBlock } from "../resolver/types";
import type { InternalWorkOwnerPort } from "../work/internal/owner-retained-work";
import {
  OWNER_WORK_STATUS_SCAN_LIMIT,
  projectOwnerWorkStatuses,
  type WorkStatusProjection,
} from "./work-status-projection";

const STATUS_CONTEXT_LIMIT = 12;
const INLINE_VALUE_LIMIT = 96;

/** Snapshot the attached owner inbox as one capped non-cacheable system block. */
export async function projectBackgroundWorkStatusContext(
  owner: InternalWorkOwnerPort,
  now: () => Date = () => new Date(),
): Promise<SystemBlock | undefined> {
  const statuses = await projectOwnerWorkStatuses(
    owner,
    OWNER_WORK_STATUS_SCAN_LIMIT,
  );
  if (statuses.length === 0) return undefined;

  const at = now();
  const rows = [...statuses]
    .sort(compareStatusPriority)
    .slice(0, STATUS_CONTEXT_LIMIT)
    .map((status) => statusRow(status, at));
  return Object.freeze({
    source: "context:background-work",
    text: `Background work:\n${rows.join("\n")}`,
    providerCache: false,
  });
}

function compareStatusPriority(
  left: WorkStatusProjection,
  right: WorkStatusProjection,
): number {
  const priority = statePriority(left) - statePriority(right);
  if (priority !== 0) return priority;
  const leftTime = Date.parse(left.finishedAt ?? left.createdAt);
  const rightTime = Date.parse(right.finishedAt ?? right.createdAt);
  const time = statePriority(left) === 0
    ? leftTime - rightTime
    : rightTime - leftTime;
  return time || left.work.id.localeCompare(right.work.id);
}

function statePriority(status: WorkStatusProjection): number {
  return status.finishedAt === undefined ? 0 : 1;
}

function statusRow(status: WorkStatusProjection, at: Date): string {
  const startedAt = Date.parse(status.startedAt ?? status.createdAt);
  const finishedAt = status.finishedAt ? Date.parse(status.finishedAt) : at.getTime();
  const elapsed = Math.max(0, Math.floor((finishedAt - startedAt) / 1_000));
  const result = status.resultAvailable ? " · Result available" : "";
  const target = status.targetLabel || status.work.targetId;
  return `- ${safeInline(status.work.id)} · ${safeInline(target)} · ${status.state} ${elapsed}s${result}`;
}

function safeInline(value: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= INLINE_VALUE_LIMIT
    ? normalized
    : `${normalized.slice(0, INLINE_VALUE_LIMIT - 1)}…`;
}
