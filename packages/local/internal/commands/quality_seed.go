package commands

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/use-crux/crux/packages/local/internal/output"
)

// seedDemoQuality writes representative quality fixtures into `.crux/quality/`.
// Runtime traces live in the canonical observability SQLite store, not in the
// quality directory, so this command only seeds the quality workbench state.
func seedDemoQuality(dir string) error {
	if dir == "" {
		dir = filepath.Join(".crux", "quality")
	}
	if err := writeSuites(dir); err != nil {
		return fmt.Errorf("suites: %w", err)
	}
	if err := writeExperiments(dir); err != nil {
		return fmt.Errorf("experiments: %w", err)
	}
	if err := writeBaselines(dir); err != nil {
		return fmt.Errorf("baselines: %w", err)
	}
	if err := writeFeedback(dir); err != nil {
		return fmt.Errorf("feedback: %w", err)
	}
	return nil
}

// writeSuites drops a single demo suite with 4 cases that mirrors the
// design's `agent-loops` example.
func writeSuites(dir string) error {
	if err := os.MkdirAll(filepath.Join(dir, "suites"), 0o755); err != nil {
		return err
	}
	suite := map[string]any{
		"_tag":      "QualitySuite",
		"suiteId":   "agent-loops",
		"name":      "agent-loops",
		"version":   "0.1.0",
		"source":    "json",
		"path":      ".crux/quality/suites/agent-loops.json",
		"caseCount": 4,
		"tags":      []string{"agent", "loop", "retrieval"},
		"scorers":   []string{"contains", "citation_validity", "rubric_score"},
		"state":     "draft",
		"cases": []map[string]any{
			{
				"caseId":   "case-001",
				"name":     "rag/typed_prompts_definition",
				"input":    "Explain typed prompts in Crux. Cite the docs.",
				"expected": "# Must include:\n- definition of typed prompts in terms of TS signatures\n- mention of input / output / tools / config\n- at least 1 citation to docs/typed-prompts\n- score ≥ 0.8 on citation_validity",
				"tags":     []string{"retrieval", "docs", "typed-prompts"},
				"assertions": []map[string]any{
					{"op": "contains", "arg": "typed prompt", "lastPass": true},
					{"op": "citation_validity", "arg": ">= 0.8", "lastPass": true},
					{"op": "citations_min", "arg": "1", "lastPass": true},
					{"op": "rubric_score", "arg": ">= 0.8", "lastPass": false},
				},
				"feedbackRating":      "down",
				"lastRunStatus":       "fail",
				"lastRunExperimentId": "exp-043",
			},
			{
				"caseId":         "case-002",
				"name":           "agent/handoff_paraphrase_loop",
				"input":          "Trigger the agent handoff with a paraphrased query.",
				"tags":           []string{"agent", "loop"},
				"feedbackRating": "down",
			},
			{
				"caseId": "case-003",
				"name":   "agent/loop_detection",
				"input":  "Detect when the retrieval agent loops on similar queries.",
				"tags":   []string{"agent", "loop"},
			},
			{
				"caseId":         "case-004",
				"name":           "rag/cassette_replay_invariants",
				"input":          "Replay against cassette and verify invariants.",
				"tags":           []string{"cassette", "rag"},
				"feedbackRating": "down",
			},
		},
	}
	return writeJSON(filepath.Join(dir, "suites", "agent-loops.json"), suite)
}

func writeExperiments(dir string) error {
	if err := os.MkdirAll(filepath.Join(dir, "experiments"), 0o755); err != nil {
		return err
	}
	now := time.Now().Format(time.RFC3339)
	pass := 88.0 / 100
	exp := map[string]any{
		"_tag":      "QualityExperiment",
		"id":        "exp-042",
		"qualityId": "demo",
		"suite": map[string]any{
			"id":        "agent-loops",
			"name":      "agent-loops",
			"caseCount": 4,
		},
		"startedAt": now,
		"endedAt":   now,
		"status":    "failed",
		"summary": map[string]any{
			"total":   4,
			"passed":  3,
			"failed":  1,
			"errored": 0,
		},
		"variants": []map[string]any{
			{"id": "baseline-014", "targetId": "docs_agent", "label": "baseline-014",
				"passRate": 0.96, "meanScore": 0.80, "tokensAvg": 4500.0, "latencyP95Ms": 4400.0, "costTotal": 0.55, "isBaseline": true},
			{"id": "maxIter-3", "targetId": "docs_agent", "label": "maxIter=3",
				"passRate": pass, "meanScore": 0.74, "tokensAvg": 6200.0, "latencyP95Ms": 5800.0, "costTotal": 0.78, "baselineDeltaPassPts": -5.0},
			{"id": "dedupe-92", "targetId": "docs_agent", "label": "dedupe=0.92",
				"passRate": 0.95, "meanScore": 0.79, "tokensAvg": 5100.0, "latencyP95Ms": 4900.0, "costTotal": 0.61, "baselineDeltaPassPts": -1.0},
			{"id": "winner", "targetId": "docs_agent", "label": "maxIter+dedupe",
				"passRate": 0.97, "meanScore": 0.82, "tokensAvg": 4200.0, "latencyP95Ms": 4100.0, "costTotal": 0.49, "isWinner": true, "baselineDeltaPassPts": 1.0},
		},
		"primaryScore": "rubric_score",
		"variantConfigs": map[string]any{
			"winner": map[string]any{
				"vsBaselineVariantId": "baseline-014",
				"lines": []map[string]any{
					{"op": "remove", "text": "agent.retrieve.maxIterations: 16", "note": "(default)"},
					{"op": "add", "text": "agent.retrieve.maxIterations: 3"},
					{"op": "add", "text": "agent.retrieve.dedupe: { strategy: 'embedding', threshold: 0.92 }"},
					{"op": "add", "text": "agent.retrieve.earlyStop: { on: 'novelDocsRatio < 0.2' }"},
				},
			},
		},
	}
	return writeJSON(filepath.Join(dir, "experiments", "exp-042.json"), exp)
}

func writeBaselines(dir string) error {
	if err := os.MkdirAll(filepath.Join(dir, "baselines"), 0o755); err != nil {
		return err
	}
	label := "baseline-014"
	rec := map[string]any{
		"_tag":         "QualityBaseline",
		"id":           "baseline-014",
		"qualityId":    "demo",
		"experimentId": "exp-041",
		"label":        &label,
		"promotedAt":   time.Now().Add(-3 * 24 * time.Hour).Format(time.RFC3339),
		"summary": map[string]any{
			"experimentId":  "exp-041",
			"passRate":      0.96,
			"total":         4,
			"passed":        4,
			"failed":        0,
			"avgDurationMs": 4400.0,
			"numericScores": map[string]float64{"rubric_score": 0.80},
		},
	}
	return writeJSON(filepath.Join(dir, "baselines", "baseline-014.json"), rec)
}

func writeFeedback(dir string) error {
	if err := os.MkdirAll(filepath.Join(dir, "feedback"), 0o755); err != nil {
		return err
	}
	rating := -1
	comment := "agent looped 12+ times on paraphrased queries; output is fine but cost is 4x expected"
	rec := map[string]any{
		"_tag":      "QualityFeedback",
		"id":        "fb-001",
		"qualityId": "demo",
		"createdAt": time.Now().Add(-10 * time.Minute).Format(time.RFC3339),
		"status":    "open",
		"rating":    &rating,
		"comment":   &comment,
		"tags":      []string{"loop", "cost-spike"},
	}
	return writeJSON(filepath.Join(dir, "feedback", "fb-001.json"), rec)
}

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0o644)
}

// runQualitySeed is the CLI entry point for `crux quality seed --demo`.
// Prints a summary of what landed and where.
func runQualitySeed(dir string) error {
	if err := seedDemoQuality(dir); err != nil {
		return err
	}
	if dir == "" {
		dir = filepath.Join(".crux", "quality")
	}
	fmt.Printf("%s Seeded demo fixtures into %s\n",
		output.Green.Render("OK"),
		output.BoldCyan.Render(dir))
	fmt.Printf("%s 1 suite (agent-loops · 4 cases · draft)\n", output.Dim.Render("*"))
	fmt.Printf("%s 1 experiment (exp-042 · 4 variants · winner = maxIter+dedupe)\n", output.Dim.Render("*"))
	fmt.Printf("%s 1 baseline (baseline-014)\n", output.Dim.Render("*"))
	fmt.Printf("%s 1 feedback row (retrieval-loop note)\n", output.Dim.Render("*"))
	fmt.Printf("\n%s Run %s to see the populated workbench.\n",
		output.Dim.Render("*"),
		output.Accent.Render("crux dev"))
	return nil
}
