import type { OwnerState } from "./internal";
import { readOwner } from "./record";
import { decodeState } from "./state-validation";
import type { StatisticsLedgerExport } from "./types";
import {
  exactKeys,
  invalid,
  readInteger,
  readObject,
  readString,
} from "./validation";

interface EncodedOwnerState {
  readonly owner: OwnerState["owner"];
  readonly cursor: number;
  readonly lastRecordFingerprint: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly activeTimeMs: number;
  readonly suspendedTimeMs: number;
  readonly usage: OwnerState["usage"];
  readonly models: readonly (readonly [string, OwnerState["usage"]])[];
  readonly otherModels?: OwnerState["usage"];
  readonly modelCalls: OwnerState["modelCalls"];
  readonly tools: OwnerState["tools"];
  readonly toolsByName: readonly (readonly [string, OwnerState["tools"]])[];
  readonly otherTools?: OwnerState["tools"];
  readonly work: OwnerState["work"];
  readonly workByTarget: readonly (readonly [string, OwnerState["work"]])[];
  readonly otherWork?: OwnerState["work"];
  readonly failures: OwnerState["failures"];
  readonly approvals: OwnerState["approvals"];
  readonly lifecycle: OwnerState["lifecycle"];
  readonly inputs: OwnerState["inputs"];
  readonly inputsByIdentity: readonly (readonly [
    string,
    OwnerState["inputs"],
  ])[];
  readonly otherInputs?: OwnerState["inputs"];
}

/** Encode one validated owner read model for host persistence. @internal */
export function encodeOwnerState(state: OwnerState): StatisticsLedgerExport {
  const encoded: EncodedOwnerState = {
    owner: { ...state.owner },
    cursor: state.cursor,
    lastRecordFingerprint: state.lastRecordFingerprint,
    startedAt: state.startedAt.toISOString(),
    updatedAt: state.updatedAt.toISOString(),
    ...(state.completedAt
      ? { completedAt: state.completedAt.toISOString() }
      : {}),
    activeTimeMs: state.activeTimeMs,
    suspendedTimeMs: state.suspendedTimeMs,
    usage: state.usage,
    models: [...state.models],
    ...(state.otherModels ? { otherModels: state.otherModels } : {}),
    modelCalls: state.modelCalls,
    tools: state.tools,
    toolsByName: [...state.toolsByName],
    ...(state.otherTools ? { otherTools: state.otherTools } : {}),
    work: state.work,
    workByTarget: [...state.workByTarget],
    ...(state.otherWork ? { otherWork: state.otherWork } : {}),
    failures: state.failures,
    approvals: state.approvals,
    lifecycle: state.lifecycle,
    inputs: state.inputs,
    inputsByIdentity: [...state.inputsByIdentity],
    ...(state.otherInputs ? { otherInputs: state.otherInputs } : {}),
  };
  return {
    version: 1,
    owner: { ...state.owner },
    cursor: state.cursor,
    state: JSON.stringify(encoded),
  };
}

/** Decode an untrusted host value without mutating ledger state. @internal */
export function decodeOwnerState(value: unknown): OwnerState {
  const envelope = readObject(value, "export envelope");
  exactKeys(
    envelope,
    ["version", "owner", "cursor", "state"],
    [],
    "export envelope",
  );
  if (envelope.version !== 1) invalid("export version");
  const owner = readOwner(envelope.owner, "export owner");
  const cursor = readInteger(envelope.cursor, "export cursor");
  const text = readString(envelope.state, "export state");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    invalid("export state");
  }
  const state = decodeState(parsed);
  if (
    state.cursor !== cursor ||
    state.owner.kind !== owner.kind ||
    state.owner.id !== owner.id
  ) {
    invalid("owner/cursor consistency");
  }
  return state;
}
