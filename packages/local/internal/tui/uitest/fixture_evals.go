package uitest

import (
	"context"
	"encoding/json"
	"time"

	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

const (
	fixtureEvalRunID         = "eval-run-demo-support-matrix-v4"
	fixtureEvalBaselineRunID = "eval-run-demo-support-baseline-v4"
)

func (c *FixtureClient) EvalCatalog(context.Context) ([]json.RawMessage, error) {
	return []json.RawMessage{fixtureJSON(map[string]any{
		"id":                    "demo.support-quality",
		"definitionFingerprint": "fixture-eval-definition-v2",
		"description":           "Checks policy accuracy and concise support replies.",
		"sourceKey":             map[string]any{"relativeFile": "evals/support.eval.ts", "export": "default"},
		"cases": []any{
			map[string]any{"id": "refund-window"},
			map[string]any{"id": "address-change"},
			map[string]any{"id": "fraud-lock"},
		},
		"variants":                 []string{"current", "concise"},
		"requiredHostCapabilities": []string{"record-store"},
		"hostReadiness": map[string]any{
			"status":   "setup-required",
			"reason":   "No deployed Runtime advertises record-store.",
			"remedies": []string{"Configure a Runtime deployment with record-store."},
		},
		"baselineCompatibility": fixtureBaselineCompatibility(),
	})}, nil
}

func (c *FixtureClient) EvalRuns(context.Context) ([]json.RawMessage, error) {
	return []json.RawMessage{c.fixtureEvalRun()}, nil
}

func (c *FixtureClient) EvalRun(_ context.Context, id string) (json.RawMessage, error) {
	if id != fixtureEvalRunID {
		return nil, readmodel.ErrNotFound
	}
	return c.fixtureEvalRun(), nil
}

func (c *FixtureClient) EvalBaselines(context.Context) ([]json.RawMessage, error) {
	return []json.RawMessage{fixtureJSON(map[string]any{
		"schemaVersion":            3,
		"baselineFingerprintEpoch": 5,
		"baselineId":               "baseline-demo-support-v2",
		"evalId":                   "demo.support-quality",
		"runId":                    fixtureEvalBaselineRunID,
		"selectedArm":              "current",
		"sourceKey":                map[string]any{"relativeFile": "evals/support.eval.ts", "export": "default"},
		"promotedAt":               c.Now.Add(-30 * time.Minute).UnixMilli(),
		"promotedBy":               "demo maintainer",
		"toolVersion":              "0.7.0",
		"coverage": []any{
			fixtureBaselineCoverage("refund-window", "passed"),
			fixtureBaselineCoverage("address-change", "passed"),
			fixtureBaselineCoverage("fraud-lock", "failed"),
		},
		"provenance": map[string]any{
			"definitionFingerprint": "fixture-eval-definition-v1",
			"taskFingerprint":       "fixture-eval-task-v1",
		},
		"snapshotFingerprint":   "fixture-baseline-snapshot-v2",
		"baselineCompatibility": fixtureBaselineCompatibility(),
	})}, nil
}

func (c *FixtureClient) fixtureEvalRun() json.RawMessage {
	cells := []any{
		fixtureEvalCell("refund-window", "current", "passed", 0.96, "run_demo_support_good", false),
		fixtureEvalCell("refund-window", "concise", "failed", 0.62, "run_demo_support_bad", false),
		fixtureEvalCell("address-change", "current", "passed", 0.91, "8af2f1c", true),
		fixtureEvalCell("address-change", "concise", "passed", 0.87, "run_demo_support_good", false),
		fixtureEvalCell("fraud-lock", "current", "skipped", 0, "", false),
		fixtureEvalCell("fraud-lock", "concise", "failed", 0.48, "run_demo_support_bad", false),
	}
	return fixtureJSON(map[string]any{
		"schemaVersion":         4,
		"runId":                 fixtureEvalRunID,
		"evalId":                "demo.support-quality",
		"sourceKey":             map[string]any{"relativeFile": "evals/support.eval.ts", "export": "default"},
		"startedAt":             c.Now.Add(-45 * time.Minute).UnixMilli(),
		"endedAt":               c.Now.Add(-44 * time.Minute).UnixMilli(),
		"definitionFingerprint": "fixture-eval-definition-v2",
		"selection": map[string]any{
			"cases":      []string{"refund-window", "address-change", "fraud-lock"},
			"variants":   []string{"current", "concise"},
			"trials":     1,
			"caseTrials": map[string]int{"refund-window": 1, "address-change": 1, "fraud-lock": 1},
		},
		"costControl":      "not_required",
		"blockingVariants": []string{"current", "concise"},
		"cells":            cells,
		"variants": []any{
			map[string]any{"name": "current", "fingerprint": "fixture-current-v2", "overrideKeys": []string{}, "blocking": true},
			map[string]any{"name": "concise", "fingerprint": "fixture-concise-v2", "overrideKeys": []string{"model"}, "blocking": true},
		},
		"aggregates": map[string]any{
			"current": fixtureEvalAggregate(2, 2, 0, 1, 0.935),
			"concise": fixtureEvalAggregate(3, 1, 2, 0, 0.656),
		},
		"gates": map[string]any{
			"passed": false, "blockingPassed": false,
			"results": []any{
				map[string]any{"gate": "quality", "variantName": "current", "threshold": 0.8, "actual": 0.935, "passed": true},
				map[string]any{"gate": "quality", "variantName": "concise", "threshold": 0.8, "actual": 0.656, "passed": false},
			},
		},
		"cost": map[string]any{
			"actualUsd": 0.084, "reservedMaximumUsd": 0, "unknownActionCount": 0,
			"task": map[string]any{"actualUsd": 0.084}, "judge": map[string]any{},
		},
		"provenance": map[string]any{"task": "managed", "host": "injected", "evidenceStore": "none"},
		"status":     "complete",
		"passed":     false,
	})
}

func fixtureEvalCell(caseID, variant, status string, score float64, runID string, reused bool) map[string]any {
	task := map[string]any{"status": "executed", "reason": "no_exact_evidence"}
	if reused {
		task = map[string]any{
			"status": "reused", "reason": "exact_evidence",
			"evidenceFingerprint": "fixture-evidence-address-v1", "evidenceRef": "evidence://address-change/current",
		}
	}
	assertionStatus := status
	if status == "skipped" {
		task = map[string]any{"status": "skipped", "reason": "source_skipped"}
		assertionStatus = "not-evaluated"
	}
	ran, notEvaluated := 1, 0
	scores := []any{fixtureEvalScore(score)}
	if status == "skipped" {
		ran, notEvaluated, scores = 0, 1, []any{}
	}
	runIDs := []string{}
	if runID != "" {
		runIDs = []string{runID}
	}
	return map[string]any{
		"caseId": caseID, "caseName": caseID, "variant": variant, "trial": 0, "status": status,
		"task": task,
		"scorerContracts": []any{
			map[string]any{"name": "quality", "contractFingerprint": "fixture-quality-v1"},
		},
		"scores": scores,
		"assertions": map[string]any{
			"ran": ran, "notEvaluated": notEvaluated,
			"outcomes": []any{
				map[string]any{
					"id": "eval:expect:0", "level": "case", "phase": "expect", "index": 0,
					"status": assertionStatus, "matcher": "toEqual", "soft": false,
				},
			},
		},
		"input":    map[string]any{"question": fixtureEvalQuestion(caseID)},
		"call":     map[string]any{"temperature": 0},
		"output":   map[string]any{"verdict": status},
		"expected": map[string]any{"verdict": "passed"},
		"response": map[string]any{"model": "fixture-support"},
		"metrics":  map[string]any{"durationMs": 800 + len(caseID)*10, "costUsd": 0.014},
		"runIds":   runIDs, "capturedSignals": []string{"modelCalls"},
	}
}

func fixtureEvalScore(value float64) map[string]any {
	return map[string]any{
		"status": "computed", "reason": "deterministic_local", "name": "quality",
		"contractFingerprint": "fixture-quality-v1", "value": value,
	}
}

func fixtureEvalAggregate(cells, passed, failed, skipped int, mean float64) map[string]any {
	return map[string]any{
		"cells": cells, "passed": passed, "failed": failed, "errored": 0, "timedOut": 0,
		"skipped": skipped, "passRate": float64(passed) / float64(cells),
		"scores": map[string]any{
			"quality": map[string]any{"mean": mean, "sem": 0.02, "n": cells},
		},
		"trialConsistency": 1, "latencyMs": 860,
	}
}

func fixtureBaselineCoverage(caseID, status string) map[string]any {
	return map[string]any{
		"caseId": caseID, "inputFingerprint": "fixture-input-" + caseID,
		"callFingerprint": "fixture-call-v1", "expectedFingerprint": "fixture-expected-" + caseID,
		"trials": []int{0}, "outcomes": []any{map[string]any{"trial": 0, "status": status}},
		"metrics": map[string]any{},
	}
}

func fixtureBaselineCompatibility() map[string]any {
	return map[string]any{
		"status": "incompatible", "reason": "case_contract_changed",
		"currentDefinitionFingerprint":  "fixture-eval-definition-v2",
		"baselineDefinitionFingerprint": "fixture-eval-definition-v1",
		"variant":                       map[string]any{"name": "current", "status": "compatible"},
		"cases": []any{
			map[string]any{"caseId": "refund-window", "status": "compatible", "metrics": []any{}},
			map[string]any{"caseId": "address-change", "status": "compatible", "metrics": []any{}},
			map[string]any{"caseId": "fraud-lock", "status": "incompatible", "reason": "expected_changed", "metrics": []any{}},
		},
		"currentOnlyCases": []string{},
	}
}

func fixtureEvalQuestion(caseID string) string {
	switch caseID {
	case "refund-window":
		return "Can I refund my monthly plan after seven days?"
	case "address-change":
		return "How do I update my billing address?"
	default:
		return "Lock my account after a suspicious login."
	}
}

func fixtureJSON(value any) json.RawMessage {
	raw, _ := json.Marshal(value)
	return raw
}
