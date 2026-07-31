/**
 * Payload-safe Thread topology for the Runtime Bridge.
 *
 * @module
 */

import { registerInspectableResource } from "../runtime-bridge/resources";
import type { Storage } from "../storage";
import {
  parseThreadControlRecord,
  parseThreadNodeRecord,
  type ThreadNodeRecord,
} from "./store/records";
import {
  threadControlKey,
  threadNodePrefix,
} from "./store/keys";

export interface ThreadBridgeNode {
  readonly id: string;
  readonly parentId?: string;
  readonly groupId: string;
  readonly seq: number;
  readonly groupEnd: boolean;
  readonly state: ThreadNodeRecord["state"];
  readonly role?: string;
}

export interface ThreadBridgeGroup {
  readonly id: string;
  readonly parentId?: string;
  readonly messageIds: readonly string[];
  readonly terminalId: string;
  readonly state: "live" | "removed" | "redacted" | "mixed";
  readonly selectedBy: readonly string[];
}

export interface ThreadBridgeBranch {
  readonly parentId?: string;
  readonly groupIds: readonly string[];
}

/** Structural Thread snapshot returned to devtools without message payloads. */
export interface ThreadRuntimeBridgePayload {
  readonly schema: 1;
  readonly threadId: string;
  readonly state: "empty" | "live" | "deleted";
  readonly heads: Readonly<Record<string, string>>;
  readonly leaves: Readonly<Record<string, string>>;
  readonly tree: readonly ThreadBridgeNode[];
  readonly groups: readonly ThreadBridgeGroup[];
  readonly branches: readonly ThreadBridgeBranch[];
}

/** Register one lazily resolved Thread topology resource. */
export function registerThreadInspectableResource(
  threadId: string,
  resolveStorage: () => Storage,
): void {
  registerInspectableResource({
    resource: `thread:${encodeURIComponent(threadId)}`,
    kind: "thread",
    description: `Thread: ${threadId}`,
    operations: ["get"],
    metadata: { threadId },
    read: async () => readThreadRuntimeBridgePayload(resolveStorage(), threadId),
  });
}

/** Read all structural records needed for the devtools Thread topology view. */
export async function readThreadRuntimeBridgePayload(
  storage: Storage,
  threadId: string,
): Promise<ThreadRuntimeBridgePayload> {
  const rawControl = await storage.records.get(threadControlKey(threadId));
  if (!rawControl) {
    return emptyPayload(threadId);
  }
  const control = parseThreadControlRecord(rawControl);
  const nodes = await readAllNodes(storage, threadId);
  const selectedByGroup = selectedOwnersByGroup(nodes, control.heads);
  const groups = threadGroups(nodes, selectedByGroup);
  return {
    schema: 1,
    threadId,
    state: control.state,
    heads: control.heads,
    leaves: control.leaves,
    tree: nodes.map(projectNode),
    groups,
    branches: threadBranches(groups),
  };
}

async function readAllNodes(
  storage: Storage,
  threadId: string,
): Promise<ThreadNodeRecord[]> {
  const nodes: ThreadNodeRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await storage.records.list(threadNodePrefix(threadId), {
      limit: 500,
      cursor,
    });
    nodes.push(...page.entries.map(({ value }) => parseThreadNodeRecord(value)));
    cursor = page.cursor;
  } while (cursor);
  return nodes.sort(
    (left, right) =>
      left.groupId.localeCompare(right.groupId) ||
      left.seq - right.seq ||
      left.id.localeCompare(right.id),
  );
}

function projectNode(node: ThreadNodeRecord): ThreadBridgeNode {
  return {
    id: node.id,
    ...(node.parentId ? { parentId: node.parentId } : {}),
    groupId: node.groupId,
    seq: node.seq,
    groupEnd: node.groupEnd,
    state: node.state,
    ...(node.state !== "redacted" ? { role: node.message.role } : {}),
  };
}

function threadGroups(
  nodes: readonly ThreadNodeRecord[],
  selectedByGroup: ReadonlyMap<string, ReadonlySet<string>>,
): ThreadBridgeGroup[] {
  const byGroup = new Map<string, ThreadNodeRecord[]>();
  for (const node of nodes) {
    const group = byGroup.get(node.groupId) ?? [];
    group.push(node);
    byGroup.set(node.groupId, group);
  }
  return [...byGroup.entries()]
    .map(([id, unsorted]) => {
      const group = [...unsorted].sort((left, right) => left.seq - right.seq);
      const terminal = group.find(({ groupEnd }) => groupEnd) ?? group.at(-1);
      if (!terminal) throw new Error(`Thread group "${id}" is empty.`);
      return {
        id,
        ...(group[0]?.parentId ? { parentId: group[0].parentId } : {}),
        messageIds: group.map(({ id: messageId }) => messageId),
        terminalId: terminal.id,
        state: groupState(group),
        selectedBy: [...(selectedByGroup.get(id) ?? [])].sort(),
      } satisfies ThreadBridgeGroup;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function groupState(
  group: readonly ThreadNodeRecord[],
): ThreadBridgeGroup["state"] {
  const states = new Set(group.map(({ state }) => state));
  return states.size === 1
    ? (states.values().next().value ?? "mixed")
    : "mixed";
}

function threadBranches(
  groups: readonly ThreadBridgeGroup[],
): ThreadBridgeBranch[] {
  const groupsByParent = new Map<string, string[]>();
  for (const group of groups) {
    const parent = group.parentId ?? "";
    const siblings = groupsByParent.get(parent) ?? [];
    siblings.push(group.id);
    groupsByParent.set(parent, siblings);
  }
  return [...groupsByParent.entries()]
    .filter(([, groupIds]) => groupIds.length > 1)
    .map(([parentId, groupIds]) => ({
      ...(parentId ? { parentId } : {}),
      groupIds: [...groupIds].sort(),
    }))
    .sort((left, right) =>
      (left.parentId ?? "").localeCompare(right.parentId ?? ""),
    );
}

function selectedOwnersByGroup(
  nodes: readonly ThreadNodeRecord[],
  heads: Readonly<Record<string, string>>,
): ReadonlyMap<string, ReadonlySet<string>> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const selected = new Map<string, Set<string>>();
  for (const [owner, head] of Object.entries(heads)) {
    let node = byId.get(head);
    const seen = new Set<string>();
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      const owners = selected.get(node.groupId) ?? new Set<string>();
      owners.add(owner);
      selected.set(node.groupId, owners);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
  }
  return selected;
}

function emptyPayload(threadId: string): ThreadRuntimeBridgePayload {
  return {
    schema: 1,
    threadId,
    state: "empty",
    heads: {},
    leaves: {},
    tree: [],
    groups: [],
    branches: [],
  };
}
