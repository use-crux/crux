---
name: crux-quality
description: Use when asked to run, fix, write, or interpret evals in a Crux project.
---

# Crux Quality

Use this skill when working on Crux Quality evals. Prefer commands with `--json`
when an agent needs to parse results, and treat filtered runs as diagnostic only.

## Run All

Use for a full local or CI verdict.

```bash
crux quality run --json
```

Read `exitCode`, `passed`, `summary`, and `evaluations[].failures[]`.

## Rerun Failures

Use after a failed experiment to rerun only the failed cells.

```bash
crux quality run --failed latest --json
```

Read `evaluations[].failures[].evidence.cellEvidenceCommand`. Filtered reruns
make gates informational; do not promote their records.

## Inspect One Failure

Use when a failure needs source, trace, assertion, or baseline evidence.

```bash
crux quality cell-evidence <experiment-id> --case <case-id> --variant default --trial 0 --json
```

Read `primaryFailure`, `sourceFrame`, `checks`, `trace`, and `baseline`.

## Diff Experiments

Use after changing a prompt, scorer, retriever, or eval case.

```bash
crux quality diff <baseline-experiment> <candidate-experiment> --json
```

Read `comparable`, `fingerprintDrift`, `scores[]`, `cases[]`, and
`gatesVerdict`.

## Add A Regression Case From A Trace

Use when a real trace should become an offline case.

```bash
crux quality import-traces --definition <definition-id> --status failed --limit 5 --out evals/cases.jsonl
```

Read generated row `metadata.datasetProvenance`; keep representative cases small.

## Label And Check A Judge

Use when calibrating judge-backed scores against human labels.

```bash
crux quality label <experiment-id> --case <case-id> --verdict pass --note "acceptable"
crux quality judge-report <evaluation-id> --json
```

Read `agreement`, `confusion`, and `disagreements[]`.

## Promote A Baseline

Use only after a full, unfiltered passing run.

```bash
crux quality promote <experiment-id> --variant default
```

Never promote records from `--case`, `--variant`, `--failed`, `--sample`, or
`--max-cost` runs.

## Deterministic CI

Use when model calls must replay from cassettes.

```bash
crux quality run --replay replay-strict --json
```

Missing cassette keys are definition errors. Re-record intentionally with
`--replay record-new` or `--replay refresh`.

## References

Point agents at `/llms.txt` for the docs index and validate machine artifacts
with `@use-crux/core/quality/schemas`.
