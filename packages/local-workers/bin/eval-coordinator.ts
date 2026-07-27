#!/usr/bin/env tsx

/** Standalone NDJSON coordinator behind the new `crux eval` namespace. */

import { createInterface } from "node:readline";

import {
  loadEvalNodeRunnerCore,
  loadEvalRunnerCore,
} from "../lib/eval-core-bridge";
import { withUserImportSession } from "@use-crux/indexer/internal/user-import";
import {
  getArg,
  getRepeatedArg,
  hasFlag,
  positionalArgs,
} from "../lib/eval-coordinator/argv";
import { createEvalInvocationBudget } from "../lib/eval-coordinator/invocation-budget";
import { costAdmissionMessage } from "../lib/eval-coordinator/cost-message";
import { projectEvalRunForCli } from "../lib/eval-coordinator/cli-run-projection";
import { projectEvalCatalogTimeouts } from "../lib/eval-coordinator/catalog-timeout";

console.log = (...args: unknown[]) => console.error(...args);

interface EvalCoordinatorEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

function emit(event: EvalCoordinatorEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main(): Promise<number> {
  return withUserImportSession(mainInUserImportSession);
}

async function mainInUserImportSession(): Promise<number> {
  const args = process.argv.slice(2);
  let confirmation: Promise<boolean> | undefined;
  const requestUnknownCostConfirmation = hasFlag(
    args,
    "--request-unknown-cost-confirmation",
  )
    ? () =>
        (confirmation ??= requestCostConfirmation().catch((error) => {
          confirmation = undefined;
          throw error;
        }))
    : undefined;
  const declineUnknownCostConfirmation = hasFlag(
    args,
    "--decline-unknown-cost-confirmation",
  )
    ? async () => false
    : undefined;
  if (args.includes("--review-add")) return addReviewCase(process.cwd());
  const catalogReadiness = args.includes("--catalog-readiness");
  const listOnly =
    args.includes("--list") ||
    catalogReadiness ||
    args[0] === "list" ||
    args.includes("--collect-only");
  const baselineRunId = getArg(args, "--baseline-set");
  const selectors = positionalArgs(args).filter(
    (arg) => arg !== "list" && arg !== "run" && arg !== baselineRunId,
  );
  const projectRoot = process.cwd();
  const watchDependencies = new Set<string>();
  try {
    const core = await loadEvalRunnerCore(projectRoot);
    const nodeRunner = await loadEvalNodeRunnerCore(projectRoot);
    const node = nodeRunner;
    let coordinatorSession:
      | Awaited<ReturnType<typeof nodeRunner.createNodeEvalCoordinatorSession>>
      | undefined;
    const getCoordinatorSession = async () =>
      (coordinatorSession ??= await nodeRunner.createNodeEvalCoordinatorSession(
        projectRoot,
        { offline: hasFlag(args, "--offline") },
      ));
    if (baselineRunId !== undefined) {
      return await setBaseline(
        node,
        projectRoot,
        baselineRunId,
        getArg(args, "--variant"),
        hasFlag(args, "--accept-failing"),
      );
    }
    const discovered = await nodeRunner.discoverProjectEvals(projectRoot);
    if (discovered.errors.length > 0) {
      emit({ type: "collect:done", evals: [], errors: discovered.errors });
      return 2;
    }
    const selection = nodeRunner.selectEvals(discovered.evals, selectors);
    if (selection.errors.length > 0) {
      emit({
        type: "collect:done",
        evals: [],
        errors: selection.errors.map((message) => ({ message })),
      });
      return 2;
    }
    const hydrated = [];
    for (const entry of selection.matches) {
      hydrated.push(
        nodeRunner.selectHydratedCases(
          await nodeRunner.hydrateEvalCases(entry, {
            projectRoot,
            registerWatchDependency: (path) => watchDependencies.add(path),
          }),
          getRepeatedArg(args, "--case"),
        ),
      );
    }
    const manifests = [];
    for (const entry of hydrated) {
      const definition = core.getEvalDefinitionForInternalUse(entry.eval);
      let requiredHostCapabilities: readonly string[];
      let hostReadiness: ReturnType<typeof catalogHostReadiness> | undefined;
      let baselineCompatibility: unknown;
      if (catalogReadiness) {
        // Fresh plan-only discovery proves deployment setup independently from
        // whether this machine happens to have reusable task evidence.
        const coordinated = await nodeRunner.coordinateNodeEval(
          entry,
          { plan: true, fresh: true, session: await getCoordinatorSession() },
          projectRoot,
        );
        requiredHostCapabilities = [
          ...new Set(
            coordinated.plan.cells.flatMap(
              (cell) => cell.requiredHostCapabilities,
            ),
          ),
        ].sort();
        hostReadiness = catalogHostReadiness(
          requiredHostCapabilities,
          coordinated.plan.hostReadiness,
        );
        const baseline = await nodeRunner
          .createEvalBaselineFileStore({ projectRoot })
          .read(entry.sourceKey);
        if (baseline !== undefined) {
          baselineCompatibility = nodeRunner.compareEvalDefinitionToBaseline(
            entry.eval,
            entry.definitionFingerprint,
            baseline,
          );
        }
      } else {
        const task = definition.task;
        requiredHostCapabilities = core.isManagedEvalTaskForInternalUse(task)
          ? [
              ...(core.getEvalTaskDescriptorForInternalUse(task)
                .requiredHostCapabilities ?? []),
            ].sort()
          : [];
      }
      const catalogTimeouts = projectEvalCatalogTimeouts(core, definition, entry.cases);
      manifests.push({
        id: entry.id,
        definitionFingerprint: entry.definitionFingerprint,
        sourceKey: entry.sourceKey,
        sidecarFile: entry.sidecarFile,
        links: entry.links,
        ...catalogTimeouts,
        variants: definition.arms.map((arm) => arm.name),
        description: definition.description,
        tags: definition.tags,
        caseFiles: entry.caseFileDependencies,
        requiredHostCapabilities,
        ...(hostReadiness !== undefined ? { hostReadiness } : {}),
        ...(baselineCompatibility !== undefined
          ? { baselineCompatibility }
          : {}),
      });
    }
    emit({ type: "collect:done", evals: manifests, errors: [] });
    if (listOnly) {
      emit({ type: "run:done", exitCode: 0, runIds: [] });
      return 0;
    }
    const variants = getRepeatedArg(args, "--variant");
    if (variants.length > 1)
      throw new TypeError(
        "V1 accepts one --variant; it runs Current plus that selected Variant.",
      );
    const maxCost = parseMaxCost(getArg(args, "--max-cost"));
    const invocationBudget = createEvalInvocationBudget(maxCost);
    const runIds: string[] = [];
    let failed = false;
    const prepared = [];
    for (const entry of hydrated) {
      const evalMaxCost = invocationBudget.limit();
      const coordinated = await nodeRunner.coordinateNodeEval(
        entry,
        {
          ...(variants[0] !== undefined ? { variant: variants[0] } : {}),
          ...(hasFlag(args, "--fresh") ? { fresh: true } : {}),
          ...(hasFlag(args, "--offline") ? { offline: true } : {}),
          ...(hasFlag(args, "--plan") ? { plan: true } : {}),
          ...(evalMaxCost !== undefined ? { maxCostUsd: evalMaxCost } : {}),
          ...(entry.filteredSelection ? { filtered: true } : {}),
          ...(hasFlag(args, "--confirm-unknown-cost")
            ? { confirmUnknownCost: true }
            : {}),
          ...(requestUnknownCostConfirmation
            ? { requestUnknownCostConfirmation }
            : {}),
          ...(declineUnknownCostConfirmation
            ? {
                requestUnknownCostConfirmation: declineUnknownCostConfirmation,
              }
            : {}),
          session: await getCoordinatorSession(),
        },
        projectRoot,
      );
      prepared.push({ entry, coordinated });
      invocationBudget.consume(coordinated.plan.cost);
      emit({ type: "eval:plan", evalId: entry.id, plan: coordinated.plan });
    }
    for (const { entry, coordinated } of prepared) {
      if (coordinated.plan.hostReadiness.status === "mismatch") {
        emit({
          type: "error",
          scope: "host",
          message: `${coordinated.plan.hostReadiness.reason} ${coordinated.plan.hostReadiness.remedy}`,
        });
        return 2;
      }
      if (hasFlag(args, "--plan")) continue;
      if (coordinated.plan.preflight.status === "blocked") {
        emit({
          type: "error",
          scope: "offline",
          message: `Offline run needs ${coordinated.plan.preflight.misses.length} uncached external result(s); no external calls were made. Run 'crux eval ${entry.id}' online or remove --offline.`,
        });
        return 2;
      }
      if (coordinated.plan.hostReadiness.status === "unverified") {
        emit({
          type: "error",
          scope: "host",
          message: `Eval '${entry.id}' requires an unverified deployed Runtime. ${coordinated.plan.hostReadiness.remedies.join(" ")}`,
        });
        return 2;
      }
      if (coordinated.plan.cost.admission.status !== "admitted") {
        emit({
          type: "error",
          scope: "cost",
          message: costAdmissionMessage(
            entry.id,
            coordinated.plan.cost.admission.reason,
            coordinated.plan.cost.actions,
          ),
        });
        return 2;
      }
    }
    if (hasFlag(args, "--plan")) {
      emit({ type: "run:done", exitCode: 0, runIds: [] });
      return 0;
    }
    for (const { entry, coordinated } of prepared) {
      emit({
        type: "eval:start",
        evalId: entry.id,
        cells: coordinated.plan.cells.length,
      });
      const run = await coordinated.execute();
      runIds.push(run.runId);
      failed ||= run.status === "incomplete" || !run.passed;
      emit({
        type: "eval:done",
        evalId: entry.id,
        run: projectEvalRunForCli(run),
      });
    }
    const exitCode = failed ? 1 : 0;
    emit({ type: "run:done", exitCode, runIds });
    return exitCode;
  } catch (error) {
    emit({
      type: "error",
      scope: "collect",
      message: publicCoordinatorError(error, projectRoot),
      watchDependencies: [...watchDependencies].sort(),
    });
    return 2;
  }
}

function publicCoordinatorError(error: unknown, projectRoot: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(projectRoot, ".");
}

function catalogHostReadiness(
  required: readonly string[],
  readiness: {
    readonly status: "local" | "verified" | "unverified" | "mismatch";
    readonly [key: string]: unknown;
  },
) {
  if (required.length === 0) {
    return { status: "ready" as const, mode: "local" as const };
  }
  if (readiness.status === "verified") {
    return {
      ...readiness,
      status: "ready" as const,
      mode: "deployed" as const,
    };
  }
  if (readiness.status === "mismatch") return readiness;
  if (readiness.status === "unverified") {
    return {
      ...readiness,
      status:
        readiness.reason === "connection_unavailable"
          ? ("setup-required" as const)
          : ("unverified" as const),
    };
  }
  return {
    status: "unverified" as const,
    reason: "readiness_not_proven",
    remedies: ["Run 'crux eval --plan' to verify the selected Runtime."],
  };
}

async function addReviewCase(projectRoot: string): Promise<number> {
  try {
    const request = JSON.parse(await readStdin()) as Record<string, unknown>;
    const node = await loadEvalNodeRunnerCore(projectRoot);
    const { redactPaths, ...authored } = request;
    const persistencePolicy = node.normalizeEvalPersistencePolicy({
      redactPaths,
    });
    const result = await node.addReviewCase(
      {
        ...authored,
        projectRoot,
      } as Parameters<typeof node.addReviewCase>[0],
      { persistencePolicy },
    );
    emit({ type: "review:add", result });
    return 0;
  } catch (error) {
    emit({
      type: "error",
      scope: "review",
      message: error instanceof Error ? error.message : String(error),
    });
    return 2;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function setBaseline(
  node: Awaited<ReturnType<typeof loadEvalNodeRunnerCore>>,
  projectRoot: string,
  runId: string,
  variant: string | undefined,
  acceptFailing: boolean,
): Promise<number> {
  const result = await node.createEvalRunFileStore({ projectRoot }).read(runId);
  if (result.status !== "found") {
    emit({
      type: "error",
      scope: "baseline",
      message:
        result.status === "missing"
          ? `Eval run '${runId}' was not found. Run 'crux eval' first.`
          : `Eval run '${runId}' is corrupt: ${result.error}`,
    });
    return 2;
  }
  if (result.run.status === "complete" && !result.run.passed) {
    if (!acceptFailing) {
      emit({
        type: "error",
        scope: "baseline",
        message: `Eval run '${runId}' is complete but failing. Re-run with --accept-failing to explicitly accept that failure as the Baseline.`,
      });
      return 2;
    }
  }
  const baseline = await node.setEvalBaseline({
    projectRoot,
    run: result.run,
    options: {
      baselineId: `baseline-${result.run.evalId}`,
      selectedArm: variant ?? "current",
      promotedAt: Date.now(),
      toolVersion: "0.5.0",
    },
  });
  emit({
    type: "baseline:done",
    runId,
    path: baseline.path,
    baseline: baseline.baseline,
  });
  emit({ type: "run:done", exitCode: 0, runIds: [] });
  return 0;
}

function parseMaxCost(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new TypeError("--max-cost must be a non-negative finite USD value.");
  return parsed;
}

async function requestCostConfirmation(): Promise<boolean> {
  emit({ type: "cost:confirmation-required" });
  const answer = (await readStdinLine()).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

async function readStdinLine(): Promise<string> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of lines) return line;
    return "";
  } finally {
    lines.close();
  }
}

process.exitCode = await main();
