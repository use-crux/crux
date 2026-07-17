#!/usr/bin/env tsx

/** Standalone NDJSON coordinator behind the new `crux eval` namespace. */

import {
  loadEvalNodeRunnerCore,
  loadEvalRunnerCore,
} from "../lib/eval-core-bridge";
import {
  getArg,
  getRepeatedArg,
  hasFlag,
  positionalArgs,
} from "../lib/eval-coordinator/argv";

console.log = (...args: unknown[]) => console.error(...args);

interface EvalCoordinatorEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

function emit(event: EvalCoordinatorEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--review-add")) return addReviewCase(process.cwd());
  const listOnly =
    args.includes("--list") ||
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
    if (baselineRunId !== undefined) {
      return await setBaseline(
        node,
        projectRoot,
        baselineRunId,
        getArg(args, "--variant"),
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
    const manifests = hydrated.map((entry) => {
      const definition = core.getEvalDefinitionForInternalUse(entry.eval);
      return {
        id: entry.id,
        sourceKey: entry.sourceKey,
        sidecarFile: entry.sidecarFile,
        links: entry.links,
        cases: entry.cases.map((item) => ({
          id: item.id,
          origin: item.origin,
          ...(item.unvalidatedExpected ? { unvalidatedExpected: true } : {}),
        })),
        variants: definition.arms.map((arm) => arm.name),
        description: definition.description,
        tags: definition.tags,
        caseFiles: entry.caseFileDependencies,
      };
    });
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
    const runIds: string[] = [];
    let failed = false;
    for (const entry of hydrated) {
      const coordinated = await nodeRunner.coordinateNodeEval(
        entry,
        {
          ...(variants[0] !== undefined ? { variant: variants[0] } : {}),
          ...(hasFlag(args, "--fresh") ? { fresh: true } : {}),
          ...(hasFlag(args, "--offline") ? { offline: true } : {}),
          ...(hasFlag(args, "--plan") ? { plan: true } : {}),
          ...(maxCost !== undefined ? { maxCostUsd: maxCost } : {}),
          ...(entry.filteredSelection ? { filtered: true } : {}),
          ...(hasFlag(args, "--confirm-unknown-cost")
            ? { confirmUnknownCost: true }
            : {}),
        },
        projectRoot,
      );
      emit({ type: "eval:plan", evalId: entry.id, plan: coordinated.plan });
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
          ),
        });
        return 2;
      }
      emit({
        type: "eval:start",
        evalId: entry.id,
        cells: coordinated.plan.cells.length,
      });
      const run = await coordinated.execute();
      runIds.push(run.runId);
      failed ||= run.status === "incomplete" || !run.passed;
      emit({ type: "eval:done", evalId: entry.id, run });
    }
    const exitCode = failed ? 1 : 0;
    emit({ type: "run:done", exitCode, runIds });
    return exitCode;
  } catch (error) {
    emit({
      type: "error",
      scope: "collect",
      message: error instanceof Error ? error.message : String(error),
      watchDependencies: [...watchDependencies].sort(),
    });
    return 2;
  }
}

async function addReviewCase(projectRoot: string): Promise<number> {
  try {
    const request = JSON.parse(await readStdin()) as Record<string, unknown>;
    const node = await loadEvalNodeRunnerCore(projectRoot);
    const result = await node.addReviewCase({
      ...request,
      projectRoot,
    } as Parameters<typeof node.addReviewCase>[0]);
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
    emit({
      type: "warning",
      message: `Eval run '${runId}' is complete but failing; accepting it records that failure in the Baseline.`,
    });
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

function costAdmissionMessage(evalId: string, reason: string): string {
  if (reason === "unknown_cost_under_cap") {
    return `Cannot enforce --max-cost for Eval '${evalId}' because pricing is unavailable. Add the project pricing override selected by Crux config, or run --plan without spending.`;
  }
  if (reason === "max_cost_exceeded")
    return `Eval '${evalId}' exceeds --max-cost; no external calls were made.`;
  return `Eval '${evalId}' has unknown external cost and requires confirmation; no external calls were made. Run --plan to inspect the actions.`;
}

process.exitCode = await main();
