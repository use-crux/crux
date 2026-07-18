/** Node planning/execution coordinator shared by scripts and Local. */

import { randomUUID } from "node:crypto";
import {
  createEvalBaselineFileStore,
  createEvalEvidenceFileStore,
  createEvalRunFileStore,
} from "./stores";
import type { HydratedEval } from "./cases";
import {
  executeEvalPlan,
  fingerprintManagedEvalTaskForInternalUse,
  getEvalTaskDescriptorForInternalUse,
  isManagedEvalTaskForInternalUse,
  planEval,
} from "../internal/runner";
import type { EvalPlan, EvalRun, EvalTaskHostRequest } from "../internal/types";
import type { EvalPlanningPorts } from "../internal/ports";
import {
  createNodeEvalHostDeployment,
  createNodeEvalHostRuntime,
} from "./host/readiness";
import {
  executeObservedEvalTaskForInternalUse,
  executeObservedOpaqueTaskForInternalUse,
} from "../internal/observed-task";
import { loadSelectedRuntimeDefinition } from "./host/runtime-config";
import {
  readExplicitNodeEvalHostDeploymentId,
  resolveNodeEvalHostDeploymentId,
} from "./host/connection";
import { createMemoryEvalReservationPort } from "../internal/reservation";
import { getEvalDefinitionForInternalUse } from "../internal/definition";
import { createNodeExternalScorerHost } from "./scorer-host";
import {
  loadGeneratedEvalPersistencePolicy,
  loadProjectEvalSettings,
} from "./project-settings";
import { fingerprintEvalValue } from "../internal/identity";
import {
  fingerprintEvalPersistencePolicy,
} from "../internal/redact";

export interface NodeEvalCoordinatorOptions {
  readonly variant?: string;
  readonly fresh?: boolean;
  readonly offline?: boolean;
  readonly plan?: boolean;
  readonly maxCostUsd?: number;
  readonly filtered?: boolean;
  /** Internal CLI transport after its explicit interactive confirmation. */
  readonly confirmUnknownCost?: boolean;
  /** Internal CLI handshake that keeps planning and execution in one process. */
  readonly requestUnknownCostConfirmation?: () => Promise<boolean>;
  readonly session?: NodeEvalCoordinatorSession;
}

export interface NodeEvalCoordinatorSession {
  readonly runtime?: Awaited<ReturnType<typeof loadSelectedRuntimeDefinition>>;
  readonly pricing?: import("../../runtime/eval-config").CruxExperimentalEvalConfig["pricing"];
  readonly persistencePolicy: import("../internal/redact").EvalPersistencePolicy;
  readonly deployment: ReturnType<typeof createNodeEvalHostDeployment>;
}

export interface CoordinatedNodeEval {
  readonly plan: EvalPlan;
  readonly execute: () => Promise<EvalRun>;
}

/** Create invocation-scoped Runtime discovery and manifest state. */
export async function createNodeEvalCoordinatorSession(
  projectRoot: string,
  options: { readonly offline?: boolean } = {},
): Promise<NodeEvalCoordinatorSession> {
  if (options.offline === true) {
    return Object.freeze({
      persistencePolicy:
        await loadGeneratedEvalPersistencePolicy(projectRoot),
      deployment: createNodeEvalHostDeployment({ projectRoot }),
    });
  }
  const settings = await loadProjectEvalSettings(projectRoot);
  const runtime = settings.runtime;
  return Object.freeze({
    ...(runtime ? { runtime } : {}),
    ...(settings.pricing !== undefined ? { pricing: settings.pricing } : {}),
    persistencePolicy: settings.persistencePolicy,
    deployment: createNodeEvalHostDeployment({
      projectRoot,
      ...(runtime ? { runtime } : {}),
    }),
  });
}

/** Plan one hydrated Eval and bind its exact execution ports. */
export async function coordinateNodeEval(
  entry: HydratedEval,
  options: NodeEvalCoordinatorOptions,
  projectRoot: string,
): Promise<CoordinatedNodeEval> {
  const baseTask = getEvalDefinitionForInternalUse(entry.eval).task;
  const session =
    options.session ??
    (await createNodeEvalCoordinatorSession(projectRoot, options));
  const runtime = session.runtime;
  const persistencePolicy = session.persistencePolicy;
  const privacyFingerprint =
    fingerprintEvalPersistencePolicy(persistencePolicy);
  const evidenceStore = createEvalEvidenceFileStore({
    projectRoot,
    persistencePolicy,
  });
  const runStore = createEvalRunFileStore({ projectRoot, persistencePolicy });
  const deployedRuntime = createNodeEvalHostRuntime({
    entry,
    projectRoot,
    ...(runtime !== undefined ? { runtime } : {}),
    deployment: session.deployment,
    persistencePolicy,
  });
  const planningPorts: EvalPlanningPorts = {
    evidenceStore,
    taskIdentity: {
      describe: async (request) => {
        if (!isManagedEvalTaskForInternalUse(request.task)) {
          return { reusable: false, reason: "identity_unavailable" };
        }
        if (!entry.sourceClosure.reusable) {
          return {
            reusable: false,
            reason: "unresolved_source_dependency",
          };
        }
        const taskSourceFingerprint =
          request.task === baseTask
            ? (entry.sourceClosure.taskSourceFingerprints?.current ??
              entry.sourceClosure.taskSourceFingerprint)
            : entry.sourceClosure.taskSourceFingerprints?.[request.variant];
        if (taskSourceFingerprint === undefined) {
          return { reusable: false, reason: "task_binding_untracked" };
        }
        const required =
          getEvalTaskDescriptorForInternalUse(request.task)
            .requiredHostCapabilities ?? [];
        const deploymentId =
          required.length === 0
            ? undefined
            : options.offline
              ? await readExplicitNodeEvalHostDeploymentId({ projectRoot })
              : await resolveNodeEvalHostDeploymentId({
                  projectRoot,
                  ...(runtime !== undefined ? { runtime } : {}),
                });
        if (required.length > 0 && deploymentId === undefined) {
          return { reusable: false, reason: "host_contract_unavailable" };
        }
        return {
          reusable: true,
          managedTaskFingerprint: fingerprintManagedEvalTaskForInternalUse(
            request.task,
            taskSourceFingerprint,
          ),
          hostContractFingerprint:
            required.length === 0
              ? fingerprintEvalValue({
                  host: "crux.eval-local-task-host",
                  privacyFingerprint,
                })
              : projectRemoteHostContractFingerprint({
                  deploymentId: deploymentId!,
                  requiredHostCapabilities: required,
                  privacyFingerprint,
                }),
        };
      },
    },
    hostReadiness: deployedRuntime.readiness,
    externalScorerHostContractFingerprint: fingerprintEvalValue({
      host: "crux.eval-local-scorer-host",
      privacyFingerprint,
    }),
    ...(entry.sourceClosure.reusable
      ? { externalScorerSourceFingerprint: entry.sourceClosure.fingerprint }
      : {}),
    costEstimator: {
      estimate: (request) =>
        isManagedEvalTaskForInternalUse(request.task)
          ? (getEvalTaskDescriptorForInternalUse(request.task).estimateCost?.({
              ...request,
              ...(session.pricing !== undefined
                ? { pricing: session.pricing }
                : {}),
            }) ?? unknownCostEstimate())
          : unknownCostEstimate(),
    },
    ...(options.confirmUnknownCost || options.requestUnknownCostConfirmation
      ? {
          costConfirmation: {
            confirm: options.confirmUnknownCost
              ? async () => true
              : options.requestUnknownCostConfirmation!,
          },
        }
      : {}),
  };
  const plan = await planEval(
    entry.eval,
    {
      sourceKey: entry.sourceKey,
      definitionFingerprint: entry.definitionFingerprint,
      ...(options.variant !== undefined ? { variant: options.variant } : {}),
      ...(options.fresh ? { fresh: true } : {}),
      ...(options.offline ? { offline: true } : {}),
      ...(options.maxCostUsd !== undefined
        ? { maxCostUsd: options.maxCostUsd }
        : {}),
      ...(options.filtered ? { filtered: true } : {}),
      interactive:
        options.plan === true ||
        options.confirmUnknownCost === true ||
        options.requestUnknownCostConfirmation !== undefined,
      ...(options.plan ? { plan: true } : {}),
    },
    planningPorts,
  );
  return Object.freeze({
    plan,
    execute: async () => {
      const baseline = await createEvalBaselineFileStore({
        projectRoot,
      }).readForEval({
        sourceKey: entry.sourceKey,
        evalId: entry.id,
        definitionFingerprint: entry.definitionFingerprint,
      });
      return executeEvalPlan(plan, {
        evidenceStore,
        runStore,
        persistencePolicy,
        ...(baseline !== undefined ? { baseline } : {}),
        clock: { now: () => Date.now() },
        ids: { next: () => `eval-${Date.now()}-${randomUUID()}` },
        ...(options.maxCostUsd !== undefined
          ? {
              reservations: createMemoryEvalReservationPort(options.maxCostUsd),
            }
          : {}),
        taskHost: {
          execute: (request) =>
            isManagedEvalTaskForInternalUse(request.task)
              ? (getEvalTaskDescriptorForInternalUse(request.task)
                  .requiredHostCapabilities?.length ?? 0) > 0
                ? deployedRuntime.execute(request)
                : executeTask(request)
              : executeObservedOpaqueTaskForInternalUse(request),
        },
        externalScorerHost: createNodeExternalScorerHost(),
      });
    },
  });
}

/** Locally trusted remote execution identity; never includes URL, token, or manifest data. */
export function projectRemoteHostContractFingerprint(input: {
  readonly deploymentId: string;
  readonly requiredHostCapabilities: readonly string[];
  readonly privacyFingerprint: string;
}): string {
  return [
    "crux.eval-host.v1",
    "result-codec.v1",
    input.deploymentId,
    [...input.requiredHostCapabilities].sort().join(","),
    input.privacyFingerprint,
  ].join(":");
}

function unknownCostEstimate() {
  return {
    kind: "unknown" as const,
    source: "unknown" as const,
    missingPricingKeys: Object.freeze([]),
    remedy:
      "Use a managed AI task and configure experimental.eval.pricing with maxUsdPerCall ceilings.",
  };
}

async function executeTask(request: EvalTaskHostRequest) {
  return executeObservedEvalTaskForInternalUse(request);
}
